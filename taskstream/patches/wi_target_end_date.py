import frappe


def execute():
	logs = frappe.get_all(
		"Work Item Log",
		fields=["parent", "time", "action_type"],
		filters={"parenttype": "Work Item"},
		order_by="creation desc",
	)

	# updated_items = set()
	for log in logs:
		# if log.parent not in updated_items:
		if log.action_type == "Target End Date":
			frappe.db.set_value("Work Item", log.parent, "target_end_date", log.time, update_modified=False)
		if log.action_type == "Actual End Time":
			frappe.db.set_value("Work Item", log.parent, "actual_end_date", log.time, update_modified=False)
			# updated_items.add(log.parent)
