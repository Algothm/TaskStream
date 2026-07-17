import frappe

from taskstream.taskstream.doctype.work_item.score_engine import calculate_score


def execute():
	done_items = frappe.get_all(
		"Work Item",
		filters={
			"status": ["in", ["Done", "Under Review"]],
			"target_end_date": ["is", "set"],
			"score_breakdown": ["is", "not set"],
		},
		fields=["name"],
	)

	for item in done_items:
		try:
			doc = frappe.get_doc("Work Item", item.name)
			calculate_score(doc, "Scheduled Job")
			frappe.db.set_value(
				"Work Item",
				item.name,
				{
					"score": doc.score,
					"score_summary": doc.score_summary,
					"score_breakdown": doc.score_breakdown,
				},
				update_modified=False,
			)
		except Exception:
			frappe.log_error(
				title=f"Score Recalculation Failed for {item.name}",
				message=frappe.get_traceback(),
			)
