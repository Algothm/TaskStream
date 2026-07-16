import frappe
from frappe.utils import now_datetime

from taskstream.taskstream.doctype.work_item.score_engine import calculate_score
from taskstream.utils import scheduler_safe_exec


@scheduler_safe_exec
def get_report_data():
	repeat_on_day = frappe.db.get_value(
		"Work Item Configuration",
		"Work Item Configuration",
		"starting_reporting_from",
	)

	if frappe.utils.now_datetime().date().strftime("%A") != repeat_on_day:
		return

	work_items = frappe.get_list(
		"Work Item",
		filters={"status": ["not in", ["Unsuccessful", "Closed", "Done", "Cancelled"]]},
	)

	for work_item in work_items:
		try:
			wi = frappe.get_cached_doc("Work Item", work_item.name)
			calculate_score(wi, "Scheduled Job")
			frappe.db.set_value(
				"Work Item",
				wi.name,
				{
					"score": wi.score,
					"score_summary": wi.score_summary,
					"score_breakdown": wi.score_breakdown,
				},
				update_modified=False,
			)
		except Exception as e:
			frappe.log_error(
				message=f"Error processing Work Item {work_item.name}: {e!s}",
				title="Report Data Scheduler",
			)

	frappe.db.set_value(
		"Work Item Configuration",
		"Work Item Configuration",
		"last_executed_on",
		now_datetime().date(),
	)
