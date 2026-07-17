import frappe


def execute():
	frappe.db.sql("""
        UPDATE `tabWork Item`
        SET status = 'Open'
        WHERE status IN ('To Do', 'In Progress')
    """)
