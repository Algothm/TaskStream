import json

import frappe
from frappe.utils import get_datetime, now_datetime

from taskstream.taskstream.doctype.work_item.score_engine import score_summary
from taskstream.taskstream.doctype.work_item_score_summary.work_item_score_summary import (
	create_summary_record,
)
from taskstream.utils import scheduler_safe_exec


@scheduler_safe_exec
def update_score():
	config = frappe.get_single("Work Item Configuration")
	now = now_datetime()

	work_items = frappe.get_all(
		"Work Item",
		filters={
			"status": ["not in", ["Done", "Unsuccessful", "Closed", "Cancelled"]],
		},
		fields=[
			"name",
			"target_end_date",
			"actual_end_date",
			"status",
			"score",
		],
	)

	for wi in work_items:
		planned_end_time = get_datetime(wi.target_end_date) if wi.target_end_date else None
		if not planned_end_time:
			continue

		actual_end_time = get_datetime(wi.actual_end_date) if wi.actual_end_date else now

		# --- Delay penalty ---
		total_delay_minutes = (actual_end_time - planned_end_time).total_seconds() / 60
		if actual_end_time <= planned_end_time:
			delay_penalty = 0
		elif total_delay_minutes < 1440:
			delay_penalty = total_delay_minutes * config.penalty_per_minute
		else:
			delay_penalty = ((total_delay_minutes // 1440) * config.penalty_points_per_day) + (
				(total_delay_minutes % 1440) * config.penalty_per_minute
			)
		delay_penalty = min(delay_penalty, config.max_delay_penalty)

		# --- Final score ---
		new_score = max(0 - delay_penalty, -100)

		# Skip if score is same
		if new_score == wi.score:
			continue

		# --- Build score_summary (HTML) ---
		summary_html = score_summary(
			delay_penalty,
			new_score,
			wi.target_end_date,
			wi.actual_end_date,
			total_delay_minutes,
			config.penalty_per_minute,
			max_delay_points=config.max_delay_penalty,
		)

		# --- Build score_breakdown (JSON) ---
		breakdown_json = json.dumps(
			{
				"score": round(new_score, 2),
				"status": wi.status,
				"is_done": wi.status == "Done",
				"components": {
					"delay": {
						"penalty": round(delay_penalty, 2),
						"max": config.max_delay_penalty,
						"delay_hours": round(max(total_delay_minutes, 0) / 60, 2),
						"is_on_time": actual_end_time <= planned_end_time,
						"target_end_date": str(wi.target_end_date) if wi.target_end_date else None,
						"actual_end_date": str(wi.actual_end_date) if wi.actual_end_date else None,
					},
				},
			}
		)

		# --- Write all fields in a single UPDATE ---
		frappe.db.set_value(
			"Work Item",
			wi.name,
			{
				"score": new_score,
				"score_summary": summary_html,
				"score_breakdown": breakdown_json,
			},
			update_modified=False,
		)

		# --- Create audit summary record ---
		create_summary_record(summary_html, wi.name, new_score, "Work Item Update")
