# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from taskstream.utils import safe_exec


class WorkFlowTemplate(Document):
	@safe_exec
	def on_submit(self):
		self.db_set("active", 1)
		if self.previous_template_version:
			frappe.db.set_value("Work Flow Template", self.previous_template_version, "active", 0)
