from datetime import timedelta

import frappe
from frappe.qb import get_query
from frappe.query_builder import DocType
from frappe.utils import now_datetime

EXCLUDED_USERS = ("Administrator", "Guest")


def customer_on_create_trigger(doc, method):
	if doc.workflow_state not in ["Draft", "Pending"]:
		return
	_create_work_item(
		doc=doc,
		roles=("Sales Manager", "Accounts Team"),
		summary="Customer Created" if doc.workflow_state == "Draft" else "Customer Approval Pending",
		description="Customer Created - A new Customer record is created"
		if doc.workflow_state == "Draft"
		else "Customer Created - Approval Pending",
	)


def expense_on_create_trigger(doc, method):
	if doc.status not in ["Draft"]:
		return
	_create_work_item(
		doc=doc,
		roles=("Reporting Manager", "Finance Team"),
		summary="Expense Created",
		description="A new expense record is created",
	)


def po_on_create_trigger(doc, method):
	if doc.workflow_state not in ["Draft", "Pending"]:
		return
	_create_work_item(
		doc=doc,
		roles=("Sr Purchase Manager",),
		summary="Purchase Order Created"
		if doc.workflow_state == "Draft"
		else "Purchase Order Approval Pending",
		description="A new Purchase Order record is created"
		if doc.workflow_state == "Draft"
		else "Purchase Order Created - Approval Pending",
	)


def so_on_create_trigger(doc, method):
	if doc.workflow_state not in ["Draft", "Pending"]:
		return
	_create_work_item(
		doc=doc,
		roles=("Sr Sales Manager",),
		summary="Sales Order Created" if doc.workflow_state == "Draft" else "Sales Order Approval Pending",
		description="A new Sales Order record is created"
		if doc.workflow_state == "Draft"
		else "Sales Order Created - Approval Pending",
	)


def _create_work_item(doc, roles, summary, description):
	if frappe.db.exists(
		"Work Item",
		{
			"reference_document": doc.name,
			"summary": summary,
			"description": description,
		},
	):
		return
	wi = frappe.new_doc("Work Item")
	wi.reporter = None
	wi.assignee = _get_work_item_assignee(doc, roles=roles)
	wi.summary = summary
	wi.description = description
	wi.reference_document = doc.name
	wi.recurrence_type = "One Time"
	wi.target_end_date = _get_future_time(2)
	# wi.append("activities", {"action_type": "Target End Date", "time": _get_future_time(2)})
	wi.save()


def _get_work_item_assignee(doc, roles):
	if isinstance(roles, str):
		roles = (roles,)

	HasRole = DocType("Has Role")
	User = DocType("User")

	qb = get_query()
	q = (
		qb.from_(HasRole)
		.join(User)
		.on(User.name == HasRole.parent)
		.select(User.name)
		.distinct()
		.where(HasRole.role.isin(roles))
		.where(User.enabled == 1)
		.where(User.user_type == "System User")
		.where(~User.name.isin(EXCLUDED_USERS))
		.orderby(HasRole.role)
		.limit(1)
	)

	assignee = q.run(as_list=True)
	if assignee:
		return assignee[0][0]

	if getattr(doc, "owner", None) and doc.owner not in EXCLUDED_USERS:
		return doc.owner

	return frappe.session.user if frappe.session.user not in EXCLUDED_USERS else None


def _get_future_time(hours):
	time = now_datetime() + timedelta(hours=hours)
	return time.replace(second=0, microsecond=0)
