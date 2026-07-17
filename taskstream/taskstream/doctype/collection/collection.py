# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document

from taskstream.utils import safe_exec


class Collection(Document):
	@safe_exec
	def validate(self):
		work_items = []
		for item in self.work_items:
			if item.work_item in work_items:
				self.work_items.remove(item)
			work_items.append(item.work_item)
