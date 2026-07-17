# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime

from taskstream.api import get_reporting_window
from taskstream.utils import safe_exec


class WorkItemScoreSummary(Document):
	pass


@safe_exec
def create_summary_record(summary, wi, score, action):
	summary_doc = frappe.new_doc("Work Item Score Summary")
	summary_doc.work_item = wi
	summary_doc.summary = summary
	summary_doc.score = score
	summary_doc.action = action
	summary_doc.created_on = now_datetime()
	summary_doc.report_cycle = get_reporting_window()
	summary_doc.insert()
