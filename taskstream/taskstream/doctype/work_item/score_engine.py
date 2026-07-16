import json

import frappe
from frappe.utils import get_datetime, now_datetime

from taskstream.taskstream.doctype.work_item_score_summary.work_item_score_summary import (
	create_summary_record,
)
from taskstream.utils import safe_exec


@safe_exec
def calculate_score(doc, action_type):
	if doc.status in ["Closed"]:
		return

	planned_end_time = get_datetime(doc.target_end_date) if doc.target_end_date else None
	actual_end_time = get_datetime(doc.actual_end_date) if doc.actual_end_date else now_datetime()

	if not planned_end_time:
		return

	config = frappe.get_single("Work Item Configuration")
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

	doc.score = max(0 - delay_penalty, -100)

	doc.score_summary = score_summary(
		delay_penalty,
		doc.score,
		doc.target_end_date,
		doc.actual_end_date,
		total_delay_minutes,
		config.penalty_per_minute,
		max_delay_points=config.max_delay_penalty,
	)
	doc.score_breakdown = json.dumps(
		{
			"score": round(doc.score, 2),
			"status": doc.status,
			"is_done": doc.status == "Done",
			"components": {
				"delay": {
					"penalty": round(delay_penalty, 2),
					"max": config.max_delay_penalty,
					"delay_hours": round(max(total_delay_minutes, 0) / 60, 2),
					"is_on_time": actual_end_time <= planned_end_time,
					"target_end_date": str(doc.target_end_date) if doc.target_end_date else None,
					"actual_end_date": str(doc.actual_end_date) if doc.actual_end_date else None,
				},
			},
		}
	)
	if doc.is_new():
		return
	# run create_summary_record if type = Scheduled Job or if there are changes in score, status, rework_count, revision_count, target_end_date (check with data before save)
	if action_type == "Scheduled Job" or (
		action_type == "Work Item Update"
		and any(
			doc.has_value_changed(f)
			for f in ("score", "status", "rework_count", "revision_count", "target_end_date")
		)
	):
		create_summary_record(doc.score_summary, doc.name, doc.score, action_type)


@safe_exec
def score_summary(
	delay_penalty,
	total_penalty,
	target_end_date,
	actual_end_date,
	delay_time,
	ppm,
	max_delay_points,
):
	delay_hours = delay_time / 60

	summary = "Delay Penalty          : " + str(round(delay_penalty, 2)) + " <br>"
	summary += "-----------------------------" + " <br>"
	summary += "Total Penalty          : " + str(round(total_penalty, 2)) + " <br>"
	summary += "-----------------------------" + " <br>"

	summary += "<b><u>Delay Penalty Breakdown</u></b>" + " <br>"
	summary += "<ul>"
	summary += "<li>Planned Target Time: " + str(target_end_date) + "</li>"
	summary += "<li>Actual Target Time: " + str(actual_end_date) + "</li>"
	summary += "<li>Delay Hours: " + str(round(delay_hours, 2)) + "</li>"
	summary += "<li>Max Delay Points: " + str(max_delay_points) + "</li>"
	summary += "</ul>"
	summary += "<u>Delay Penalty Calculation</u><br>"
	summary += "Penalty Points per Minute: " + str(ppm) + "<br>"
	summary += (
		"Delay Penalty: ("
		+ str(round(delay_hours, 2))
		+ " * 60 * "
		+ str(round(ppm, 2))
		+ ") = "
		+ str(round(delay_hours * 60 * round(ppm, 2), 2))
		+ " or "
		+ str(round(max_delay_points, 2))
		+ "(Whichever is lowest)"
		+ "<br><br>"
	)

	return summary


@frappe.whitelist()
@safe_exec
def recalculate_score(docname):
	doc = frappe.get_doc("Work Item", docname)
	doc.save()
