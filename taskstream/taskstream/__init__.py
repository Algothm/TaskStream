import frappe
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification

STATUS_COLORS = {
	"Open": "#3b82f6",
	"To Do": "#6366f1",
	"In Progress": "#f59e0b",
	"Under Review": "#8b5cf6",
	"Done": "#10b981",
	"On Hold": "#6b7280",
	"Rework Needed": "#ef4444",
	"Unsuccessful": "#dc2626",
}

PRIORITY_COLORS = {
	"Low": "#22c55e",
	"Medium": "#f59e0b",
	"High": "#ef4444",
}


def _get_full_name(user):
	"""Get the full name for a user, falling back to the user ID."""
	return frappe.db.get_value("User", user, "full_name") or user if user else ""


def build_notification_content(
	doc,
	heading,
	notification_type="general",
	additional_doctype=None,
	additional_docname=None,
):
	"""Build a rich HTML notification email from a Work Item doc.

	Args:
		doc: Work Item document (or its name as a string)
		heading: The heading/title line for the email
		notification_type: One of 'one_time' or 'general'

	Returns:
		Rendered HTML string
	"""
	if isinstance(doc, str):
		doc = frappe.get_doc("Work Item", doc)

	if additional_doctype and additional_docname:
		url = frappe.utils.get_url_to_form(additional_doctype, additional_docname)
	else:
		url = frappe.utils.get_url_to_form("Work Item", doc.name)

	# Resolve full names
	assignee_name = _get_full_name(doc.assignee)
	reporter_name = _get_full_name(doc.reporter)
	requester_name = _get_full_name(doc.requester)
	reviewer_name = _get_full_name(doc.reviewer)

	# Build description text based on notification type
	notification_description = ""
	if notification_type == "one_time":
		notification_description = "A new Work Item has been created."
	elif doc.status == "Done":
		notification_description = "Work Item has been completed."
	elif doc.status == "Unsuccessful":
		notification_description = "Work Item has been marked as unsuccessful."

	context = {
		"doc": doc,
		"heading": heading,
		"url": url,
		"assignee_name": assignee_name,
		"reporter_name": reporter_name,
		"requester_name": requester_name,
		"reviewer_name": reviewer_name,
		"status_color": STATUS_COLORS.get(doc.status, "#6b7280"),
		"priority_color": PRIORITY_COLORS.get(doc.priority, "#6b7280"),
		"frappe": frappe,
		"notification_type": notification_type,
		"notification_description": notification_description,
	}

	return frappe.render_template(
		"templates/work_item_notification.html",
		context,
	)


def send_notifications(work_item, content, to, doctype=None, docname=None, cc=None, subject=None):
	config = frappe.get_single("Work Item Configuration")
	email_subject = subject or f"Notification for Work Item: {work_item}"

	# Remove any CC recipients that are already in the TO list
	if cc and to:
		to_set = set(to)
		cc = [addr for addr in cc if addr not in to_set]

	if to and "Administrator" in to:
		to.remove("Administrator")
	if cc and "Administrator" in cc:
		cc.remove("Administrator")

	if config.email_alert:
		frappe.sendmail(
			recipients=to,
			cc=cc or None,
			subject=email_subject,
			message=content,
		)
		return

	if config.system_notification:
		for user in to:
			notification_doc = {
				"type": "Share",
				"document_type": "Work Item" if doctype is None else doctype,
				"subject": email_subject,
				"document_name": work_item if docname is None else docname,
				"from_user": frappe.session.user,
			}

			enqueue_create_notification(user, notification_doc)
