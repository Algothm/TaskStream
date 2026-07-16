from functools import wraps

import frappe
from frappe import _
from frappe.utils import add_days, nowdate

from taskstream.taskstream import build_notification_content, send_notifications


def _exec_guard(func, throw_on_error=True):
	@wraps(func)
	def wrapper(*args, **kwargs):
		try:
			return func(*args, **kwargs)
		except (
			frappe.ValidationError,
			frappe.PermissionError,
			frappe.AuthenticationError,
			frappe.SecurityException,
			frappe.SessionExpired,
			frappe.SessionStopped,
			frappe.Redirect,
			frappe.NotFound,
		):
			raise
		except Exception:
			frappe.log_error(message=frappe.get_traceback(), title=f"{func.__name__} Error")
			if throw_on_error:
				frappe.throw(_("An error occurred, please contact admin"))

	return wrapper


def safe_exec(func):
	"""For request-facing code — logs + throws a generic error to the user."""
	return _exec_guard(func, throw_on_error=True)


def scheduler_safe_exec(func):
	"""For scheduler jobs — logs silently, never throws."""
	return _exec_guard(func, throw_on_error=False)


def check_before_allow(value, check_type):
	wic = frappe.get_single("Work Item Configuration")
	if check_type == "Rework":
		check_value = wic.max_allowed_rework
	elif check_type == "Time Revision":
		check_value = wic.max_allowed_revision
	else:
		check_value = 0

	return value <= check_value


# The dashboard UI (work_item_dashboard.js) groups items into
# overdue/today/tomorrow/upcoming sections but no longer bounds the
# "upcoming" window itself — this is the single source of truth for it.
# Done items are excluded too, but that's a non-issue since they
# auto-transition to Closed shortly after completion (see
# tasks/recurrence_mark_as_closed.py) and so never sit around long enough
# to age past the window.
_UPCOMING_WINDOW_DAYS = 30

_WORK_ITEM_FIELDS = [
	"name",
	"summary",
	"description",
	"status",
	"assignee",
	"reporter",
	"requester",
	"reviewer",
	"target_end_date",
	"creation",
	"score",
	"priority",
	"rework_count",
	"revision_count",
	"review_required",
	"work_flow_template",
]


@frappe.whitelist()
def get_dashboard_data(mode="assigned_to_me"):
	"""Return Work Item dashboard data for the current user.

	mode: "assigned_to_me" (default) or "assigned_by_me"
	"""
	user = frappe.session.user

	# Exclusive upper bound so the entire final day of the window is included
	# regardless of the time-of-day stored on target_end_date. No lower bound,
	# so overdue items (any distance in the past) are still included.
	upcoming_cutoff = add_days(nowdate(), _UPCOMING_WINDOW_DAYS + 1)

	if mode == "assigned_by_me":
		# Items where the user is either the reporter or the requester
		items = frappe.db.get_list(
			"Work Item",
			fields=_WORK_ITEM_FIELDS,
			filters=[
				["status", "not in", ["Cancelled", "Closed", "Unsuccessful"]],
				["target_end_date", "<", upcoming_cutoff],
			],
			or_filters=[
				["reporter", "=", user],
				["requester", "=", user],
			],
			order_by="target_end_date asc",
			limit_page_length=200,
		)
	else:
		items = frappe.get_list(
			"Work Item",
			fields=_WORK_ITEM_FIELDS,
			filters={
				"assignee": user,
				"status": ["not in", ["Cancelled", "Closed", "Unsuccessful"]],
				"target_end_date": ["<", upcoming_cutoff],
			},
			order_by="target_end_date asc",
			limit_page_length=200,
		)

	item_names = [it.name for it in items]
	attachment_counts = {}
	if item_names:
		rows = frappe.db.sql(
			"""
			SELECT parent, COUNT(*) as cnt
			FROM `tabWork Item Attachment`
			WHERE parent IN %s
			  AND parenttype = 'Work Item'
			  AND parentfield = 'attachments'
			GROUP BY parent
			""",
			(item_names,),
			as_dict=True,
		)
		for row in rows:
			attachment_counts[row.parent] = row.cnt

	user_emails = set()
	for it in items:
		if it.assignee:
			user_emails.add(it.assignee)
		if it.reporter:
			user_emails.add(it.reporter)
		if it.requester:
			user_emails.add(it.requester)
		if it.reviewer:
			user_emails.add(it.reviewer)

	user_names = {}
	if user_emails:
		rows = frappe.get_list(
			"User",
			filters={"name": ["in", list(user_emails)]},
			fields=["name", "full_name"],
		)
		for row in rows:
			user_names[row.name] = row.full_name

	# Items with a pending time extension request
	pending_extension_map = {}  # work_item_reference -> extension request name
	if item_names:
		ext_rows = frappe.db.sql(
			"""
			SELECT name, work_item_reference
			FROM `tabWork Item Time Extension`
			WHERE work_item_reference IN %s
			  AND status = 'Pending'
			""",
			(item_names,),
			as_dict=True,
		)
		pending_extension_map = {r.work_item_reference: r.name for r in ext_rows}

	for item in items:
		item["attachment_count"] = attachment_counts.get(item.name, 0)
		item["assignee_full_name"] = user_names.get(item.assignee) or item.assignee
		item["reporter_full_name"] = user_names.get(item.reporter) or item.reporter
		item["requester_full_name"] = user_names.get(item.requester) or item.requester
		item["reviewer_full_name"] = user_names.get(item.reviewer) or item.reviewer
		item["pending_extension"] = item.name in pending_extension_map
		item["pending_extension_name"] = pending_extension_map.get(item.name)

	return items


@frappe.whitelist()
@safe_exec
def sent_noti(work_item):
	doc = frappe.get_doc("Work Item", work_item)
	to = []
	cc = []
	if doc.reviewer:
		cc.append(doc.reviewer)
	if doc.assignee:
		to.append(doc.assignee)
	if doc.reporter:
		cc.append(doc.reporter)
	if doc.requester:
		cc.append(doc.requester)

	if "Administrator" in to:
		to.remove("Administrator")
	if "Administrator" in cc:
		cc.remove("Administrator")

	if not doc.first_mail:
		notification_type = "one_time"
		heading = "New Work Item Created"
		subject = "New Work Item Created"

		content = build_notification_content(
			doc,
			heading=heading,
			notification_type=notification_type,
		)
		send_notifications(doc.name, content, to, cc=cc, subject=subject)
		frappe.db.set_value("Work Item", doc.name, "first_mail", 1)
		# doc.first_mail = 1
		# doc.save(ignore_permissions=True)
	else:
		content = build_notification_content(
			doc,
			heading="Work Item Updated",
		)
		send_notifications(doc.name, content, to, cc=cc, subject="Work Item Updated")
