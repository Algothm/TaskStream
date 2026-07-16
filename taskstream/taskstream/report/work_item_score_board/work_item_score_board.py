# Copyright (c) 2026, Chethan - Aerele and contributors
# For license information, please see license.txt

import urllib.parse
from collections import defaultdict
from functools import lru_cache

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder.functions import Coalesce, Count, Sum
from frappe.utils import add_days, get_datetime, getdate, now_datetime

from taskstream.api import get_cycles


def execute(filters=None):
	# wic = frappe.get_doc("Work Item Configuration", "Work Item Configuration")
	wic = frappe.db.get_value(
		"Work Item Configuration",
		None,
		["last_executed_on", "no_of_cycles_in_report", "reporting_frequency", "starting_date"],
		as_dict=True,
	)
	wic["no_of_cycles_in_report"] = int(wic.get("no_of_cycles_in_report") or 0)
	wic["reporting_frequency"] = int(wic.get("reporting_frequency") or 0)

	if (
		wic.get("last_executed_on") is None
		or wic.get("no_of_cycles_in_report") == 0
		or wic.get("reporting_frequency") == 0
	):
		frappe.throw(_("Please Complete the Work Item Configuration setup to run the report."))
	cycle_dates = get_cycles(
		wic.get("last_executed_on"),
		wic.get("reporting_frequency"),
		wic.get("no_of_cycles_in_report"),
		wic.get("starting_date"),
	)
	columns = get_columns(cycle_dates)
	data = get_data(filters, cycle_dates)
	return columns, data


def get_columns(cycle_dates):
	columns = [
		{
			"label": "User / Team",
			"fieldname": "user",
			"fieldtype": "Data",
			"width": 360,
			"indent_based_on": "indent",
		},
		{"label": "Active tasks", "fieldname": "active_tasks", "fieldtype": "Data", "width": 300},
		{"label": "Score(Active Score)", "fieldname": "score", "fieldtype": "Data", "width": 300},
	]
	for cycle in cycle_dates:
		columns.append({"label": f"{cycle}", "fieldname": f"score_{cycle}", "fieldtype": "Data"})
	return columns


def get_data(filters=None, cycle_dates=None):
	filters = filters or {}
	# from_date = filters.get("from_date") or frappe.utils.add_months(frappe.utils.today(), -1)
	# to_date = filters.get("to_date") or frappe.utils.today()
	roles = frappe.get_roles(frappe.session.user)

	def _compute_visible_users():
		if any(role in ["System Manager", "Work Item Admin"] for role in roles):
			return None if (filters.get("user") is None) else {filters.get("user")}

		current_user = frappe.session.user

		employee_to_user, employee_display_by_name, reports_to_by_employee, children_by_manager = (
			get_employee_list()
		)

		emp_name = frappe.db.get_value("Employee", {"user_id": current_user, "status": "Active"}, "name")
		if not emp_name:
			return {current_user}

		stack = [emp_name]
		descendants = set()
		while stack:
			cur = stack.pop()
			if cur in descendants:
				continue
			descendants.add(cur)
			for c in children_by_manager.get(cur, []):
				if c not in descendants:
					stack.append(c)

		visible = {current_user}
		for en in descendants:
			uid = employee_to_user.get(en)
			if uid:
				visible.add(uid)

		return visible

	visible_users = _compute_visible_users()

	work_item = DocType("Work Item")
	current_datetime = now_datetime()
	last_executed_on, reporting_frequency = frappe.db.get_value(
		"Work Item Configuration", "Work Item Configuration", ["last_executed_on", "reporting_frequency"]
	)
	start_dt = add_days(last_executed_on, 1)
	end_dt = add_days(last_executed_on, int(reporting_frequency))
	start_dt = get_datetime(getdate(start_dt))
	end_dt = get_datetime(getdate(end_dt)).replace(hour=23, minute=59, second=59, microsecond=999999)

	query = (
		frappe.qb.from_(work_item)
		.select(
			work_item.assignee.as_("user"),
			Sum(Coalesce(work_item.score, 0)).as_("total_score"),
			Count(work_item.name).as_("work_item_count"),
		)
		.where(
			(
				(work_item.actual_end_date.between(start_dt, end_dt))
				& (work_item.status.isin(["Done", "Closed"]))
			)
			| (
				(work_item.target_end_date < current_datetime)
				& (work_item.status.notin(["Done", "Closed", "Unsuccessful", "Cancelled"]))
			)
		)
		.groupby(work_item.assignee)
		.orderby(work_item.assignee)
	)

	base_rows = query.run(as_dict=True)

	active_tasks_query = (
		frappe.qb.from_(work_item)
		.select(
			work_item.assignee.as_("user"),
			Count(work_item.name).as_("active_tasks"),
		)
		.where(work_item.status.isin(["Open", "Under Review"]))
		.where(work_item.target_end_date.between(start_dt, end_dt))
		.groupby(work_item.assignee)
		.orderby(work_item.assignee)
	)
	active_tasks_rows = active_tasks_query.run(as_dict=True)

	# Fetch per-cycle scores from Work Item Score Summary
	cycle_scores_raw = []
	if cycle_dates:
		try:
			cycle_scores_raw = frappe.get_all(
				"Work Item Score Summary",
				filters={"report_cycle": ("in", cycle_dates), "action": "Scheduled Job"},
				fields=["assignee", "report_cycle", "score", "work_item"],
			)
		except Exception:
			cycle_scores_raw = []

	# Build per-user per-cycle totals and counts
	user_cycle_wi_scores = defaultdict(lambda: defaultdict(dict))
	for rec in cycle_scores_raw:
		assignee = rec.get("assignee")
		cycle = rec.get("report_cycle")
		score = rec.get("score") or 0.0
		work_item = rec.get("work_item")

		if not assignee or not cycle or not work_item:
			continue

		if work_item not in user_cycle_wi_scores[assignee][cycle]:
			user_cycle_wi_scores[assignee][cycle][work_item] = score
		else:
			user_cycle_wi_scores[assignee][cycle][work_item] = max(
				user_cycle_wi_scores[assignee][cycle][work_item], score
			)

	user_cycle_stats = defaultdict(lambda: defaultdict(lambda: {"total": 0.0, "count": 0}))
	for assignee, cycles in user_cycle_wi_scores.items():
		for cycle, wi_scores in cycles.items():
			for max_score in wi_scores.values():
				user_cycle_stats[assignee][cycle]["total"] += max_score
				user_cycle_stats[assignee][cycle]["count"] += 1

	erpnext_with_employee = is_erpnext_installed()
	rows = (
		get_hierarchical_scores(base_rows, cycle_dates, user_cycle_stats, active_tasks_rows)
		if erpnext_with_employee
		else build_average_rows(base_rows, cycle_dates, user_cycle_stats, active_tasks_rows)
	)

	if visible_users is not None:
		rows = [row for row in rows if row.get("user_id") in visible_users]

	return rows if erpnext_with_employee else sorted(rows, key=lambda row: row.get("user") or "")


def is_erpnext_installed():
	return "erpnext" in frappe.get_installed_apps() and frappe.db.exists("DocType", "Employee")


@lru_cache(maxsize=1)
def _fetch_employees_active():
	employees = frappe.get_all(
		"Employee",
		fields=["name", "employee_name", "user_id", "company_email", "personal_email", "reports_to"],
		filters={"status": "Active"},
	)
	employee_to_user = {}
	employee_display_by_name = {}
	reports_to_by_employee = {}
	children_by_manager = defaultdict(list)
	for employee in employees:
		employee_name = employee.get("name")
		employee_user = employee.get("user_id")
		employee_display = (
			employee.get("employee_name")
			or employee.get("company_email")
			or employee.get("personal_email")
			or employee_name
			or employee_user
		)
		reports_to = employee.get("reports_to")
		if not employee_name:
			continue

		reports_to_by_employee[employee_name] = reports_to
		employee_display_by_name[employee_name] = employee_display
		if employee_user:
			employee_to_user[employee_name] = employee_user
		if reports_to:
			children_by_manager[reports_to].append(employee_name)

	return employee_to_user, employee_display_by_name, reports_to_by_employee, children_by_manager


def build_average_rows(base_rows, cycle_dates=None, user_cycle_stats=None, active_tasks_rows=None):
	cycle_dates = cycle_dates or []
	user_cycle_stats = user_cycle_stats or {}
	active_tasks_rows = active_tasks_rows or []

	stats_by_user = defaultdict(lambda: {"total_score": 0, "work_item_count": 0, "active_tasks": 0})
	for row in base_rows:
		user = row.get("user")
		if not user:
			continue
		stats_by_user[user]["total_score"] = row.get("total_score") or 0
		stats_by_user[user]["work_item_count"] = row.get("work_item_count") or 0

	for row in active_tasks_rows:
		user = row.get("user")
		if not user:
			continue
		stats_by_user[user]["active_tasks"] = row.get("active_tasks") or 0

	avg_rows = []
	for user_id, stats in stats_by_user.items():
		count = stats.get("work_item_count", 0)
		total_score = stats.get("total_score", 0)
		active_tasks = stats.get("active_tasks", 0)
		row_data = {
			"user": user_id,
			"user_id": user_id,
			"active_tasks": active_tasks,
			"score": round(total_score / count, 0) if count else 0,
		}
		for cycle in cycle_dates:
			stats = user_cycle_stats.get(user_id, {}).get(cycle, {"total": 0.0, "count": 0})
			score_val = round(stats["total"] / stats["count"], 0) if stats["count"] else 0
			if user_id and stats["count"]:
				url_params = urllib.parse.urlencode(
					{"assignee": user_id, "report_cycle": cycle, "action": "Scheduled Job"}
				)
				base = frappe.utils.get_url_to_form("Work Item Score Summary", "")
				row_data[f"score_{cycle}"] = f"<a href='{base}?{url_params}' target='_blank'>{score_val}</a>"
			else:
				row_data[f"score_{cycle}"] = score_val

		avg_rows.append(row_data)
	return avg_rows


def get_hierarchical_scores(base_rows, cycle_dates=None, user_cycle_stats=None, active_tasks_rows=None):
	cycle_dates = cycle_dates or []
	user_cycle_stats = user_cycle_stats or {}
	active_tasks_rows = active_tasks_rows or []

	stats_by_user = defaultdict(lambda: {"total_score": 0, "work_item_count": 0, "active_tasks": 0})
	for row in base_rows:
		assignee = row.get("user")
		if not assignee:
			continue
		stats_by_user[assignee]["total_score"] = row.get("total_score") or 0
		stats_by_user[assignee]["work_item_count"] = row.get("work_item_count") or 0

	for row in active_tasks_rows:
		assignee = row.get("user")
		if not assignee:
			continue
		stats_by_user[assignee]["active_tasks"] = row.get("active_tasks") or 0

	employee_to_user, employee_display_by_name, reports_to_by_employee, children_by_manager, stats_by_user = (
		get_employee_list(stats_by_user)
	)

	memo = {}
	active_stack = set()

	def aggregate_employee(employee_name):
		if employee_name in memo:
			return memo[employee_name]
		if employee_name in active_stack:
			# cycle totals: zeros
			cycle_totals_zero = {cycle: {"total": 0.0, "count": 0} for cycle in cycle_dates}
			return 0, 0, 0, cycle_totals_zero

		active_stack.add(employee_name)

		employee_user = employee_to_user.get(employee_name)
		own_stats = stats_by_user.get(
			employee_user, {"total_score": 0, "work_item_count": 0, "active_tasks": 0}
		)
		total_score = own_stats.get("total_score", 0)
		work_item_count = own_stats.get("work_item_count", 0)
		active_tasks = own_stats.get("active_tasks", 0)

		# per-cycle totals for this node (employee)
		cycle_totals = {cycle: {"total": 0.0, "count": 0} for cycle in cycle_dates}
		if employee_user:
			for cycle in cycle_dates:
				st = user_cycle_stats.get(employee_user, {}).get(cycle)
				if st:
					cycle_totals[cycle]["total"] += st.get("total", 0.0)
					cycle_totals[cycle]["count"] += st.get("count", 0)

		for child_employee in children_by_manager.get(employee_name, []):
			child_total_score, child_work_item_count, child_active_tasks, child_cycle_totals = (
				aggregate_employee(child_employee)
			)
			total_score += child_total_score
			work_item_count += child_work_item_count
			active_tasks += child_active_tasks
			for cycle in cycle_dates:
				ctot = child_cycle_totals.get(cycle, {"total": 0.0, "count": 0})
				cycle_totals[cycle]["total"] += ctot.get("total", 0.0)
				cycle_totals[cycle]["count"] += ctot.get("count", 0)

		active_stack.remove(employee_name)
		memo[employee_name] = (total_score, work_item_count, active_tasks, cycle_totals)
		return memo[employee_name]

	def to_score(total_score, work_item_count):
		return round(total_score / work_item_count, 0) if work_item_count else 0

	def make_row(
		user, user_id, total_score, work_item_count, active_tasks, indent, is_group, cycle_values=None
	):
		row = {
			"user": user,
			"user_id": user_id,
			"active_tasks": active_tasks,
			"score": to_score(total_score, work_item_count),
			"indent": indent,
			"is_group": is_group,
		}
		cycle_values = cycle_values or {}
		for cycle in cycle_dates:
			c = cycle_values.get(cycle, {"total": 0.0, "count": 0})
			score_val = to_score(c.get("total", 0.0), c.get("count", 0))
			if user_id and not is_group and c.get("count", 0):
				url_params = urllib.parse.urlencode(
					{"assignee": user_id, "report_cycle": cycle, "action": "Scheduled Job"}
				)
				base = frappe.utils.get_url_to_form("Work Item Score Summary", "")
				row[f"score_{cycle}"] = f"<a href='{base}?{url_params}' target='_blank'>{score_val}</a>"
			else:
				row[f"score_{cycle}"] = score_val
		return row

	def get_user_stats(employee_user):
		return stats_by_user.get(employee_user, {"total_score": 0, "work_item_count": 0, "active_tasks": 0})

	def sort_key(employee_name):
		return (
			employee_to_user.get(employee_name)
			or employee_display_by_name.get(employee_name)
			or employee_name
		)

	rows = []
	visited = set()

	def add_employee_rows(employee_name, indent=0):
		if employee_name in visited:
			return
		visited.add(employee_name)
		employee_user = employee_to_user.get(employee_name)
		own_stats = get_user_stats(employee_user)
		team_total_score, team_work_item_count, team_active_tasks, team_cycle_totals = aggregate_employee(
			employee_name
		)
		children = children_by_manager.get(employee_name, [])
		has_children = bool(children)

		if has_children:
			rows.append(
				make_row(
					user=f"{employee_display_by_name.get(employee_name)} (Team)",
					user_id=employee_user,
					total_score=team_total_score,
					work_item_count=team_work_item_count,
					active_tasks=team_active_tasks,
					indent=indent,
					is_group=1,
					cycle_values=team_cycle_totals,
				)
			)

			if employee_user:
				rows.append(
					make_row(
						user=employee_display_by_name.get(employee_name) or employee_user,
						user_id=employee_user,
						total_score=own_stats.get("total_score", 0),
						work_item_count=own_stats.get("work_item_count", 0),
						active_tasks=own_stats.get("active_tasks", 0),
						indent=indent + 1,
						is_group=0,
						cycle_values=user_cycle_stats.get(employee_user, {}),
					)
				)

			for child_employee in sorted(children, key=sort_key):
				add_employee_rows(child_employee, indent + 1)
			return

		if employee_user:
			# leaf employee row
			rows.append(
				make_row(
					user=employee_display_by_name.get(employee_name) or employee_user,
					user_id=employee_user,
					total_score=own_stats.get("total_score", 0),
					work_item_count=own_stats.get("work_item_count", 0),
					active_tasks=own_stats.get("active_tasks", 0),
					indent=indent,
					is_group=0,
					cycle_values=user_cycle_stats.get(employee_user, {}),
				)
			)

	all_employee_names = set(reports_to_by_employee)
	root_employees = sorted(
		[
			employee_name
			for employee_name in all_employee_names
			if not reports_to_by_employee.get(employee_name)
			or reports_to_by_employee.get(employee_name) not in all_employee_names
		],
		key=sort_key,
	)
	if not root_employees:
		root_employees = sorted(all_employee_names, key=sort_key)

	for root_employee in root_employees:
		add_employee_rows(root_employee, indent=0)

	# If any employee was not reachable from roots (broken/cyclic hierarchy), still show them.
	for employee_name in sorted(all_employee_names, key=sort_key):
		if employee_name not in visited:
			add_employee_rows(employee_name, indent=0)

	# Handle users with scores who are not mapped to Employee
	employee_users = set(employee_to_user.values())
	non_employee_users = sorted(set(stats_by_user) - employee_users)
	for assignee in non_employee_users:
		stats = stats_by_user.get(assignee, {})
		rows.append(
			make_row(
				user=assignee,
				user_id=assignee,
				total_score=stats.get("total_score") or 0,
				work_item_count=stats.get("work_item_count") or 0,
				active_tasks=stats.get("active_tasks") or 0,
				indent=0,
				is_group=0,
				cycle_values=user_cycle_stats.get(assignee, {}),
			)
		)

	if not rows:
		return build_average_rows(base_rows, cycle_dates, user_cycle_stats, active_tasks_rows)

	return rows


def get_employee_list(stats_by_user=None):
	employee_to_user, employee_display_by_name, reports_to_by_employee, children_by_manager = (
		_fetch_employees_active()
	)
	if stats_by_user:
		for uid in employee_to_user.values():
			stats_by_user.setdefault(uid, {"total_score": 0, "work_item_count": 0, "active_tasks": 0})
		return (
			employee_to_user,
			employee_display_by_name,
			reports_to_by_employee,
			children_by_manager,
			stats_by_user,
		)
	return employee_to_user, employee_display_by_name, reports_to_by_employee, children_by_manager
