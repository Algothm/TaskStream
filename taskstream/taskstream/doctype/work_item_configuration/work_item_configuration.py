# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days

from taskstream.utils import safe_exec


class WorkItemConfiguration(Document):
	@safe_exec
	def validate(self):
		if self.reporting_frequency > 31:
			frappe.throw(_("Reporting frequency cannot be more than 31 days."))

		if self.starting_date and not self.last_executed_on:
			self.last_executed_on = add_days(self.starting_date, -1)

		if not self.max_allowed_delay_in_days:
			frappe.throw(_("Max Allowed Delay (In Days) must be greater than 0."))

		self.penalty_points_per_day = self.delay_penalty / self.max_allowed_delay_in_days
		self.penalty_per_minute = self.penalty_points_per_day / 1440
		self.max_delay_penalty = self.delay_penalty
