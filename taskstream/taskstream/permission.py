import frappe


def work_item_user_condition(user=None):
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user) or []

	if user == "Administrator" or "Work Item Admin" in roles:
		# No restriction for admins / work item admins
		return None

	escaped_user = frappe.db.escape(user)

	return (
		f"(`tabWork Item`.requester = {escaped_user} OR "
		f"`tabWork Item`.assignee = {escaped_user} OR "
		f"`tabWork Item`.reviewer = {escaped_user} OR "
		f"`tabWork Item`.reporter = {escaped_user})"
	)


def work_item_time_extension_user_condition(user=None):
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user) or []

	if user == "Administrator" or "Work Item Admin" in roles:
		return "1=1"

	escaped_user = frappe.db.escape(user)

	approver_exists = (
		"EXISTS (SELECT 1 FROM `tabApproval User` au "
		"WHERE au.parenttype = 'Work Item Time Extension' "
		"AND au.parentfield = 'approver' "
		"AND au.parent = `tabWork Item Time Extension`.name "
		f"AND au.user = {escaped_user})"
	)

	return f"(`tabWork Item Time Extension`.requester = {escaped_user} OR {approver_exists})"
