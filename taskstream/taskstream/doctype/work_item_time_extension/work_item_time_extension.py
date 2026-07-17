# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

from datetime import datetime

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from taskstream.utils import safe_exec


class WorkItemTimeExtension(Document):
	@safe_exec
	def validate(self):
		requested_due_date = self.requested_due_date
		current_target_date = self.current_target_date

		if isinstance(requested_due_date, str):
			requested_due_date = datetime.strptime(requested_due_date, "%Y-%m-%d %H:%M:%S")

		if isinstance(current_target_date, str):
			current_target_date = datetime.strptime(current_target_date, "%Y-%m-%d %H:%M:%S")

		if current_target_date > requested_due_date:
			frappe.throw(_("Enter a valid Date"))

	@safe_exec
	def after_insert(self):
		if self.approver and any(row.user == self.requester for row in self.approver):
			update_status(self.work_item_reference, "Approved", self)


@frappe.whitelist()
@safe_exec
def update_status(docname, status, wit=None):
	if not wit:
		wit = frappe.get_doc("Work Item Time Extension", docname)
	if frappe.get_value("Work Item", wit.work_item_reference, "status") in ["Done", "Closed", "Unsuccessful"]:
		frappe.db.set_value("Work Item Time Extension", docname, "status", "Rejected")
		frappe.msgprint(_("Work Item is already closed"))
		return
	wit.reviewed_by = frappe.session.user
	wit.reviewed_on = now_datetime().replace(second=0, microsecond=0)
	wit.status = status
	if status == "Approved":
		# add the requested_due_date date to the work item in the wit.work_item_reference, efficiently(new doc to hcild table ?)
		wi_doc = frappe.get_doc("Work Item", wit.work_item_reference)
		# wi_doc.append("activities", {"action_type": "Target End Date", "time": wit.requested_due_date})
		wi_doc.target_end_date = wit.requested_due_date
		if wit.do_not_impact_score == 0:
			wi_doc.revision_count += 1

		wi_doc.save()
	wit.save()
