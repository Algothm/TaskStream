from datetime import datetime

import frappe
from frappe.query_builder import DocType
from frappe.utils import add_days, now_datetime

from taskstream.utils import scheduler_safe_exec


@scheduler_safe_exec
def update_done_to_closed():
	auto_close_after_days = (
		frappe.db.get_single_value("Work Item Configuration", "auto_close_after_days") * -1
	)
	end_threshold_date = datetime.combine(
		add_days(now_datetime(), auto_close_after_days), datetime.max.time()
	)

	work_item = DocType("Work Item")

	items_to_close = (
		frappe.qb.from_(work_item)
		.select(work_item.name, work_item.status)
		.where(work_item.status.isin(["Done", "Unsuccessful"]))
		.where(work_item.actual_end_date.isnotnull())
		.where(work_item.actual_end_date < end_threshold_date)
		.run(as_dict=True)
	)

	if items_to_close:
		item_names = [d.name for d in items_to_close]
		frappe.qb.update(work_item).set(work_item.status, "Closed").where(
			work_item.name.isin(item_names)
		).run()

		for item in items_to_close:
			frappe.get_doc(
				{
					"doctype": "Version",
					"ref_doctype": "Work Item",
					"docname": item.name,
					"data": frappe.as_json({"changed": [["status", item.status, "Closed"]]}),
				}
			).insert(ignore_permissions=True)
