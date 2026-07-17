from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import add_days, get_datetime

from taskstream.utils import scheduler_safe_exec


@frappe.whitelist()
def delete_file_if_exists(file_name):
	if not frappe.db.exists("File", file_name):
		return

	attached_to_doctype, owner = frappe.db.get_value("File", file_name, ["attached_to_doctype", "owner"])
	if attached_to_doctype != "Work Item" or owner != frappe.session.user:
		frappe.throw(_("You do not have permission to delete this file.", frappe.PermissionError))
	frappe.delete_doc("File", file_name, ignore_permissions=True)


def get_reporting_window():
	last_executed_on, reporting_frequency = frappe.db.get_value(
		"Work Item Configuration", "Work Item Configuration", ["last_executed_on", "reporting_frequency"]
	)
	last_executed_on = get_datetime(last_executed_on).date()
	start_date = add_days(last_executed_on, 1)
	end_date = add_days(start_date, int(reporting_frequency or 0) - 1)
	return f"{start_date.strftime('%b %d')} - {end_date.strftime('%b %d')}"


def get_cycles(last_date, reporting_frequency, no_of_cycles, starting_date):
	from datetime import datetime

	last_date = datetime.strptime(str(last_date), "%Y-%m-%d")
	cycles = []

	current_end = last_date

	for _i in range(no_of_cycles):
		start = current_end - timedelta(days=reporting_frequency - 1)
		if starting_date and start >= get_datetime(starting_date):
			cycles.append(f"{start.strftime('%b %d')} - {current_end.strftime('%b %d')}")
		current_end = start - timedelta(days=1)

	return list(cycles)


@frappe.whitelist()
def get_all_work_flow_template_tasks(wft):
	frappe.has_permission("Work Flow Template", doc=wft, throw=True)
	return frappe.get_all(
		"Work Flow Template Item",
		filters={"parent": wft},
		fields=["assignee", "task_name", "task_description", "idx", "target_end_duration"],
	)


@frappe.whitelist()
def get_work_flow_pipeline(wi_name, wft):
	"""Return template steps merged with real WI status for each spawned step."""
	tasks = frappe.get_all(
		"Work Flow Template Item",
		filters={"parent": wft},
		fields=["assignee", "task_name", "task_description", "idx", "target_end_duration"],
	)

	# Walk up to the master (idx=1) WI to find the full work_flow_tasks table.
	# Any WI in the chain has work_flow as 1 and the same work_flow_template.
	# The master is the one with idx=1 whose work_flow_tasks is populated.
	master_name = frappe.db.get_value(
		"Work Item",
		{"work_flow_template": wft, "idx": 1, "work_flow": 1},
		"name",
	)

	wi_by_idx = {}  # {task_idx: {name, status, actual_end_date}}
	if master_name:
		wft_rows = frappe.get_all(
			"Work Flow Task",
			filters={"parent": master_name},
			fields=["task_idx", "work_item"],
		)
		for row in wft_rows:
			if row.task_idx and row.work_item:
				wi_doc = (
					frappe.db.get_value(
						"Work Item",
						row.work_item,
						["status", "actual_end_date"],
						as_dict=True,
					)
					or {}
				)
				wi_by_idx[row.task_idx] = {
					"name": row.work_item,
					"status": wi_doc.get("status"),
					"actual_end_date": wi_doc.get("actual_end_date"),
				}

	for t in tasks:
		wi = wi_by_idx.get(t["idx"]) or {}
		t["linked_wi"] = wi.get("name") or ""
		t["linked_wi_status"] = wi.get("status") or ""
		t["linked_wi_actual_end"] = wi.get("actual_end_date") or ""

	return tasks


@scheduler_safe_exec
def clear_employee_cache():
	from taskstream.taskstream.report.work_item_score_board.work_item_score_board import (
		_fetch_employees_active,
	)

	_fetch_employees_active.cache_clear()
