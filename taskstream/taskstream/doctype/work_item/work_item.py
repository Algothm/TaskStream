# Copyright (c) 2025, Chethan - Aerele and contributors
# For license information, please see license.txt
from datetime import timedelta

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import get_datetime, now_datetime

from taskstream.taskstream import build_notification_content, send_notifications
from taskstream.taskstream.doctype.work_item.score_engine import (
	calculate_score,
)
from taskstream.taskstream.doctype.work_item_score_summary.work_item_score_summary import (
	create_summary_record,
)
from taskstream.utils import check_before_allow, safe_exec, sent_noti


class WorkItem(Document):
	def autoname(self):
		self.name = make_autoname("WI-.####", self.doctype)

	@safe_exec
	def validate(self):
		if not self.is_new() and self.has_value_changed("target_end_date"):
			is_end_date_not_in_past(self.target_end_date)

		if not self.assigned_on:
			self.assigned_on = now_datetime().date()

		if not self.target_end_date:
			frappe.throw(_("Activities must include one 'Target End Date' entry."))

		self.validate_reviewer()

		if not self.is_new():
			calculate_score(self, "Work Item Update")

		if self.work_flow_template and self.work_flow:
			if self.idx == 0:
				self.idx = 1
			if self.status == "Done":
				create_sub_task(self, self.idx)

	@safe_exec
	def validate_reviewer(self):
		if self.reviewer == self.assignee:
			frappe.throw(_("Assignee and Reviewer cannot be same"))

	@safe_exec
	def before_save(self):
		old_doc = self.get_doc_before_save()
		if not old_doc:
			return

		if self.has_value_changed("assignee"):
			self.seen_by_assignee = 0
			self.seen_by_assignee_on = None

		key_field_changed = any(
			self.has_value_changed(field)
			for field in [
				"reviewer",
				"reporter",
				"summary",
				"description",
				"assignee",
				"review_required",
			]
		)

		if not (key_field_changed):
			return

		is_admin = frappe.session.user == "Administrator" or "Work Item Admin" in frappe.get_roles(
			frappe.session.user
		)
		if not is_admin and frappe.session.user not in [
			self.reporter,
			self.requester,
		]:
			frappe.throw(_("Only the owner can modify key details of this Work Item."))

	@safe_exec
	def after_insert(self):
		if self.score_summary:
			create_summary_record(self.score_summary, self.name, self.score, "Work Item Update")
		if self.work_flow and self.work_flow_template:
			frappe.enqueue(
				sync_work_flow_tasks,
				work_item_name=self.name,
				queue="default",
				enqueue_after_commit=True,
			)


def is_end_date_not_in_past(date):
	now = now_datetime()
	if get_datetime(date) < now:
		frappe.throw(_("End date cannot be in the past."))


@frappe.whitelist()
@safe_exec
def send_for_review(docname, reviewer):
	frappe.db.set_value("Work Item", docname, "status", "Under Review")
	content = build_notification_content(
		docname,
		heading="Work Item Sent for Review",
	)
	send_notifications(docname, content, to=[reviewer])


@frappe.whitelist()
@safe_exec
def mark_seen_by_assignee(docname):
	"""Record that the assignee has viewed the Work Item.

	Skipped for self-assigned items (reporter == assignee) since the
	reporter already knows they've seen it.
	"""
	assignee, reporter, seen = frappe.db.get_value(
		"Work Item", docname, ["assignee", "reporter", "seen_by_assignee"]
	)
	if seen or not assignee or assignee == reporter:
		return
	if frappe.session.user != assignee:
		return
	frappe.db.set_value(
		"Work Item",
		docname,
		{
			"seen_by_assignee": 1,
			"seen_by_assignee_on": now_datetime(),
		},
	)


@frappe.whitelist()
@safe_exec
def mark_complete(docname):
	doc = frappe.get_doc("Work Item", docname)
	if doc.benefit_of_work_done < 1 and doc.review_required == 1:
		frappe.throw(_("Please enter a valid benefit of work done"))
	doc.status = "Done"
	doc.actual_end_date = now_datetime().replace(second=0, microsecond=0)
	# doc.append(
	# 	"activities",
	# 	{"action_type": "Actual End Time", "time": now_datetime().replace(second=0, microsecond=0)},
	# )
	doc.save()
	sent_noti(docname)


# @frappe.whitelist()
# def start_now(docname):
# 	frappe.db.set_value("Work Item", docname, "status", "In Progress")
# 	frappe.db.set_value("Work Item", docname, "first_mail", 1)


@frappe.whitelist()
@safe_exec
def resend_for_rework(docname, rework_comments, target_end_date):
	doc = frappe.get_doc("Work Item", docname)
	if not check_before_allow(doc.rework_count, "Rework"):
		frappe.throw(_("Max Limit Reached for Rework."))
	doc.status = "Open"
	doc.rework_count += 1
	if target_end_date:
		doc.target_end_date = get_datetime(target_end_date).replace(second=0, microsecond=0)
		# doc.append(
		# 	"activities",
		# 	{
		# 		"action_type": "Target End Date",
		# 		"time": get_datetime(target_end_date).replace(second=0, microsecond=0),
		# 	},
		# )
	doc.save()
	doc.add_comment("Comment", rework_comments)
	content = build_notification_content(
		doc,
		heading="Work Item Sent for Rework",
	)
	send_notifications(docname, content, to=[doc.assignee])


@safe_exec
def calculate_planned_target(doc):
	# planned_end_time = None

	# for row in doc.activities:
	# 	if row.action_type == "Target End Date" and (planned_end_time is None or row.time > planned_end_time):
	# 		planned_end_time = row.time

	if planned_end_time := doc.target_end_date:
		planned_end_time = get_datetime(planned_end_time)
		sent_alert_on = frappe.get_single_value("Work Item Configuration", "sent_reminder_before")
		hr, mm, sec = [int(float(x)) for x in sent_alert_on.split(":")]
		total_minutes = hr * 60 + mm
		reminder_delta = timedelta(minutes=total_minutes)
		doc.twenty_percent_reminder_time = planned_end_time - reminder_delta
		doc.twenty_percent_reminder_time = doc.twenty_percent_reminder_time.replace(second=0, microsecond=0)
		doc.twenty_percent_reminder_sent = 0


# @safe_exec
# def ensure_time(value):
# 	if isinstance(value, timedelta):
# 		total_seconds = int(value.total_seconds())
# 		hours = total_seconds // 3600
# 		minutes = (total_seconds % 3600) // 60
# 		seconds = total_seconds % 60
# 		return time(hour=hours, minute=minutes, second=seconds)
# 	return value


# def send_twenty_percent_reminders():
# 	now = now_datetime().replace(second=0, microsecond=0)
# 	items = frappe.get_all("Work Item", filters={
# 		"status": "In Progress",
# 		"twenty_percent_reminder_sent": 0,
# 		"twenty_percent_reminder_time": ("=", now)
# 	}, fields=["name", "assignee"])

# 	for item in items:
# 		user_email = frappe.db.get_value("User", item.assignee, "email")
# 		if user_email:
# 			frappe.sendmail(
# 				recipients=[user_email],
# 				subject=f"Reminder: Work Item {item.name} nearing deadline",
# 				message=f"You're at 20% remaining time for the Work Item <b>{item.name}</b>. Please plan accordingly.<br><a href='{frappe.utils.get_url()}/app/work-item/{item.name}'>View Work Item</a>",
# 				now=True
# 			)
# 			frappe.db.set_value("Work Item", item.name, "twenty_percent_reminder_sent", 1)
# 		else:
# 			frappe.log_error("Work Item Reminder Error", f"User {item.assignee} does not have a valid email.")

# def send_deadline_reminders():
# 	now = now_datetime().replace(second=0, microsecond=0)
# 	items = frappe.get_all("Work Item", filters={
# 		"status": "In Progress",
# 		"deadline_reminder_sent": 0,
# 		"planned_end": ("=", now)
# 	}, fields=["name", "assignee"])

# 	for item in items:
# 		user_email = frappe.db.get_value("User", item.assignee, "email")
# 		if user_email:
# 			frappe.sendmail(
# 				recipients=[user_email],
# 				subject=f"Work Item {item.name} Deadline Reached",
# 				message=f"The deadline is met for the Work Item <b>{item.name}</b>, but it's still marked as <i>In Progress</i>. Please review it.<br><a href='{frappe.utils.get_url()}/app/work-item/{item.name}'>View Work Item</a>",
# 				now=True
# 			)
# 			frappe.db.set_value("Work Item", item.name, "deadline_reminder_sent", 1)
# 		else:
# 			frappe.log_error("Deadline Reminder Error", f"User {item.assignee} has no valid email.")


@safe_exec
def create_sub_task(self, idx):
	if frappe.db.exists("Work Flow Template Item", {"parent": self.work_flow_template, "idx": idx + 1}):
		# task = frappe.get_doc("Work Flow Template Item", {"parent": self.work_flow_template, "idx": idx + 1})
		task = frappe.db.get_value(
			"Work Flow Template Item",
			{"parent": self.work_flow_template, "idx": idx + 1},
			["task_name", "task_description", "assignee", "target_end_duration"],
			as_dict=1,
		)
		title = frappe.db.get_value(
			"Work Flow Template Item", {"parent": self.work_flow_template, "idx": idx}, "task_name"
		)
		if self.summary and title:
			extra = self.summary.replace(title, "", 1).strip(" -")
		else:
			extra = ""

		doc = frappe.copy_doc(self)
		doc.activities = []
		doc.status = "Open"
		doc.summary = task.get("task_name") + extra
		doc.idx = idx + 1
		doc.description = task.get("task_description")
		doc.assignee = task.get("assignee") or self.assignee
		doc.start_date_time = now_datetime().replace(second=0, microsecond=0)
		doc.target_end_date = (
			now_datetime() + timedelta(seconds=int(task.get("target_end_duration")))
		).replace(second=0, microsecond=0)
		doc.actual_end_date = None
		doc.score = 0
		doc.rework_count = 0
		doc.revision_count = 0
		doc.benefit_of_work_done = 100
		doc.save()
		sent_noti(doc.name)


@frappe.whitelist()
@safe_exec
def update_target_end_on_start_date_change(work_flow_template, start_date_time, duration=None):
	if not duration:
		duration = frappe.get_value(
			"Work Flow Template Item", {"parent": work_flow_template, "idx": 1}, "target_end_duration"
		)
	if duration and start_date_time:
		target_end = get_datetime(start_date_time) + timedelta(seconds=int(duration))
		return target_end.replace(second=0, microsecond=0)


@frappe.whitelist()
@safe_exec
def time_extension_request(doc, reason, req_target_date_time):
	doc = frappe.get_doc("Work Item", doc)
	if not check_before_allow(doc.revision_count, "Time Revision"):
		frappe.throw(_("Max Limit Reached for Time Revision."))
	if ext_name := frappe.db.exists(
		"Work Item Time Extension", {"work_item_reference": doc.name, "status": "Pending"}
	):
		ext_doc = frappe.get_doc("Work Item Time Extension", ext_name)
		ext_doc.requested_due_date = req_target_date_time
		ext_doc.reason = reason
	else:
		ext_doc = frappe.new_doc("Work Item Time Extension")
		ext_doc.work_item_reference = doc.name
		ext_doc.current_target_date = doc.target_end_date
		ext_doc.requested_due_date = req_target_date_time
		ext_doc.reason = reason
		ext_doc.requester = doc.assignee
	to = []
	for approver in {doc.requester, doc.reporter}:
		if approver:
			ext_doc.append("approver", {"user": approver})
			to.append(approver)
	ext_doc.requested_date = now_datetime()
	ext_doc.save()
	ext_doc.reload()
	content = build_notification_content(
		doc,
		heading="Time Extension Requested",
		additional_doctype="Work Item Time Extension",
		additional_docname=ext_doc.name,
	)
	send_notifications(doc.name, content, to, doctype="Work Item Time Extension", docname=ext_doc.name)
	if ext_doc.status == "Approved":
		return {"message": "Time Extension automatically approved as the user is an approver"}
	return {"message": "Time Extension Requested"}


@frappe.whitelist()
@safe_exec
def reassign(wi, new_assignee, current_assignee, reason):
	reassign_doc = frappe.new_doc("Reassignment History")
	reassign_doc.work_item_ref = wi
	reassign_doc.assignee_from = current_assignee
	reassign_doc.assignee_to = new_assignee
	reassign_doc.reasonremarks = reason
	reassign_doc.reassignment_date_time = now_datetime()
	reassign_doc.reassigned_by = frappe.session.user
	reassign_doc.save()
	frappe.db.set_value(
		"Work Item",
		wi,
		{
			"assignee": new_assignee,
			"seen_by_assignee": 0,
			"seen_by_assignee_on": None,
		},
	)
	content = build_notification_content(
		wi,
		heading="Work Item Reassigned",
	)
	to = [
		current_assignee,
		new_assignee,
	]
	send_notifications(wi, content, to, doctype=None, docname=None)


@frappe.whitelist()
@safe_exec
def get_wft_data(wft):
	return frappe.get_doc("Work Flow Template Item", {"parent": wft, "idx": 1})


# Note for AI:
# 1) All Users have Read and Write permission on Work Item, and only Work Item Admin has delete permission on Work Item (check on create_permission function in install.py)
# 2) After insert needs explicit commit
#
#


@safe_exec
def sync_work_flow_tasks(work_item_name):
	doc = frappe.get_doc("Work Item", work_item_name)

	existing_tasks = [row.work_item for row in doc.work_flow_tasks if row.work_item]

	new_entry = {
		"work_item": doc.name,
		"task_idx": doc.idx,
	}

	if doc.name not in existing_tasks:
		doc.append("work_flow_tasks", new_entry)
		doc.flags.ignore_validate = True
		doc.save()
		existing_tasks.append(doc.name)

	for old_wi_name in existing_tasks:
		if old_wi_name == doc.name:
			continue

		old_doc = frappe.get_doc("Work Item", old_wi_name)
		has_task = any(row.work_item == doc.name for row in old_doc.work_flow_tasks)

		if not has_task:
			old_doc.append("work_flow_tasks", new_entry)
			old_doc.flags.ignore_validate = True
			old_doc.save()


#
