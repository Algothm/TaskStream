import frappe
from frappe.utils import add_days, now_datetime

from taskstream.utils import scheduler_safe_exec


@scheduler_safe_exec
def expire_work_items():
	date = add_days(now_datetime(), -1).replace(hour=23, minute=59, second=59)
	expired_docs = frappe.get_all(
		"Work Item",
		filters={
			"auto_expire_on_target_end_date": 1,
			"status": ["not in", ["Done", "Unsuccessful", "Closed", "Cancelled"]],
			"target_end_date": ["<=", date],
		},
		fields=["name"],
	)

	if not expired_docs:
		return

	for d in expired_docs:
		frappe.db.set_value("Work Item", d.name, "status", "Unsuccessful")
