import frappe


def execute():
	tasks = frappe.get_all("Work Flow Template Item", fields=["name", "target_end_date_time"])
	for task in tasks:
		if task.target_end_date_time:
			frappe.db.set_value(
				"Work Flow Template Item",
				task.name,
				"target_end_duration",
				task.target_end_date_time.total_seconds(),
			)
