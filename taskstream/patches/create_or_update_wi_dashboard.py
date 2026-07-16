import frappe

from taskstream.taskstream.custom_html_block.work_item_dashboard.setup import create_or_update_block


def execute():
	create_or_update_block()
