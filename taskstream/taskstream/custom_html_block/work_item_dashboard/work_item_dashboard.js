/* ═══════════════════════════════════════════════════════════════════════════
   Work Item Dashboard — JS Controller  (Frappe Custom HTML Block)
   ═══════════════════════════════════════════════════════════════════════════ */
/* global root_element */

(function () {
	// ── State ──
	let allItems = [];
	let activeStatus = "Open";

	// ── Helpers ──
	const $ = (sel) => root_element.querySelector(sel);
	const $$ = (sel) => root_element.querySelectorAll(sel);

	// ── Date helpers ──
	function todayStr() {
		return frappe.datetime.get_today();
	}
	function tomorrowStr() {
		return frappe.datetime.add_days(todayStr(), 1);
	}
	function formatTime(dt) {
		if (!dt) return "";
		const d = new Date(dt);
		let h = d.getHours(),
			m = d.getMinutes();
		return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
	}
	function friendlyDate(dt) {
		if (!dt) return "";
		const d = new Date(dt);
		const months = [
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Nov",
			"Dec",
		];
		return d.getDate() + " " + months[d.getMonth()];
	}

	// ── Classify item into time group ──
	// The 30-day upcoming window itself is enforced server-side
	// (taskstream.utils.get_dashboard_data) — every non-Done item this
	// function sees already falls inside it, so there's nothing left to
	// bound here. "later" only remains as a defensive fallback for the
	// (should-never-happen) case of a missing target_end_date slipping through.
	function classifyGroup(item) {
		const today = todayStr();
		const tomorrow = tomorrowStr();
		const ted = (item.target_end_date || "").slice(0, 10);
		if (!ted) return "later";
		if (ted < today) return "overdue";
		if (ted === today) return "today";
		if (ted === tomorrow) return "tomorrow";
		return "upcoming";
	}

	// ── State ──
	let activeView = "assigned"; // "assigned" | "byMe"

	// ── Status → badge CSS class ──
	function statusClass(status) {
		const map = {
			Open: "wi-badge-open",
			"Under Review": "wi-badge-under-review",
			"On Hold": "wi-badge-on-hold",
			"Rework Needed": "wi-badge-rework",
			Done: "wi-badge-done",
			"In Progress": "wi-badge-in-progress",
			"To Do": "wi-badge-to-do",
		};
		return map[status] || "wi-badge-open";
	}

	// ── Helpers ──
	function isEnabled(value) {
		return value === 1 || value === "1" || value === true;
	}

	function gapColor(score) {
		if (score == null) return "var(--text-3)";
		return score >= -10
			? "var(--gap-green)"
			: score >= -35
			? "var(--gap-amber)"
			: "var(--gap-red)";
	}

	// ── Priority signal bars SVG ──
	function priorityBars(priority) {
		const p = (priority || "Medium").toLowerCase();
		const high = p === "high";
		const medium = p === "high" || p === "medium";
		const color = high ? "var(--p-high)" : p === "medium" ? "var(--p-medium)" : "var(--p-low)";
		const muted = "var(--border)";
		return `<span class="wi-priority-bars" title="${priority || "Medium"}">
			<span style="background:${color}"></span>
			<span style="background:${medium ? color : muted}"></span>
			<span style="background:${high ? color : muted}"></span>
		</span>`;
	}

	// ── Row chevron SVG ──
	const chevronSvg = `<svg class="wi-row-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

	// ── Inline tags (attach, review, flow) ──
	function inlineTags(item, timeGroup) {
		const time = timeGroup === "today" ? formatTime(item.target_end_date) : "";
		const hasAttach = (item.attachment_count || 0) > 0;
		const hasReview = isEnabled(item.review_required);
		const hasFlow = Boolean(item.work_flow_template);
		let tags = "";
		if (time) tags += `<span class="wi-row-time-tag">${time}</span>`;
		if (hasAttach)
			tags += `<span class="wi-row-icon-tag" title="${item.attachment_count} attachment(s)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg></span>`;
		if (hasReview)
			tags += `<span class="wi-row-icon-tag" title="Review required"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg></span>`;
		if (hasFlow)
			tags += `<span class="wi-row-icon-tag" title="${frappe.utils.escape_html(
				item.work_flow_template
			)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="8.5" y="13" width="7" height="7" rx="1.5"/><path d="M10 8h4M12 11v2"/></svg></span>`;
		return tags;
	}

	// ── Expanded panel ──
	function formatDelayDuration(hours) {
		if (hours < 24) return `${hours.toFixed(1)}h`;
		const days = Math.floor(hours / 24);
		const rem = hours % 24;
		return `${days}d ${rem.toFixed(0)}h`;
	}

	function renderExpanded(item) {
		const score = item.score;
		const scoreColor = gapColor(score);
		const scoreDisplay = score == null ? "—" : (score > 0 ? "+" : "") + score.toFixed(1);
		const hasReview = isEnabled(item.review_required);
		const showMarkDone = item.status === "Open";
		const showSendReview = item.status === "Open" && hasReview;

		let delayHours = 0;
		if (item.status !== "Done" && item.target_end_date) {
			delayHours = (Date.now() - new Date(item.target_end_date).getTime()) / 3600000;
		}

		return `<div class="wi-expanded">
		<div class="wi-expanded-inner">
			${
				item.description
					? `<div class="wi-expanded-desc">${frappe.utils.html2text(
							item.description
					  )}</div>`
					: ""
			}
			<div class="wi-expanded-grid">
				<div>
					<div class="wi-expanded-heading">Gap</div>
					<div class="wi-expanded-row"><span class="wi-expanded-label">Score</span><span class="wi-expanded-value wi-gap-value-lg" style="color:${scoreColor}">${scoreDisplay}</span></div>
					${
						delayHours > 0
							? `<div class="wi-expanded-row"><span class="wi-expanded-label">Overdue by</span><span class="wi-expanded-value" style="color:var(--p-high)">${formatDelayDuration(
									delayHours
							  )}</span></div>`
							: ""
					}
					${
						(item.revision_count || 0) > 0
							? `<div class="wi-expanded-row"><span class="wi-expanded-label">Revisions</span><span class="wi-expanded-value">${item.revision_count}</span></div>`
							: ""
					}
					${
						(item.rework_count || 0) > 0
							? `<div class="wi-expanded-row"><span class="wi-expanded-label">Reworks</span><span class="wi-expanded-value">${item.rework_count}</span></div>`
							: ""
					}
				</div>
				<div>
					<div class="wi-expanded-heading">Details</div>
					<div class="wi-expanded-row"><span class="wi-expanded-label">Priority</span><span class="wi-expanded-value">${
						item.priority || "Medium"
					}</span></div>
					<div class="wi-expanded-row"><span class="wi-expanded-label">Created</span><span class="wi-expanded-value">${
						item.creation ? friendlyDate(item.creation) : "—"
					}</span></div>
				</div>
				<div>
					<div class="wi-expanded-heading">People</div>
					${
						activeView === "byMe"
							? ""
							: `<div class="wi-expanded-row"><span class="wi-expanded-label">Reporter</span><span class="wi-expanded-value">${frappe.utils.escape_html(
									item.reporter || "—"
							  )}</span></div>`
					}
					<div class="wi-expanded-row"><span class="wi-expanded-label">Requester</span><span class="wi-expanded-value">${frappe.utils.escape_html(
						item.requester || "—"
					)}</span></div>
					${
						hasReview
							? `<div class="wi-expanded-row"><span class="wi-expanded-label">Review Required</span><span class="wi-expanded-value">Yes</span></div>
							<div class="wi-expanded-row"><span class="wi-expanded-label">Reviewer</span><span class="wi-expanded-value">${frappe.utils.escape_html(
								item.reviewer || "—"
							)}</span></div>`
							: ""
					}
				</div>
			</div>
			<div class="wi-expanded-actions">
				${
					showMarkDone
						? `<button class="wi-btn wi-btn-success wi-action-done" data-name="${item.name}">Mark Complete</button>`
						: ""
				}
				${
					showSendReview
						? `<button class="wi-btn wi-btn-warning wi-action-review" data-name="${item.name}">Send for Review</button>`
						: ""
				}
				<button class="wi-btn wi-btn-ghost wi-action-open" data-name="${item.name}">Open Full Form</button>
			</div>
		</div>
	</div>`;
	}

	// ── Render a single row ──
	function renderRow(item, timeGroup) {
		const priority = item.priority || "Medium";
		const priClass = priority.toLowerCase();
		const score = item.score;
		const scoreColor = gapColor(score);
		const scoreDisplay = score == null ? "—" : (score > 0 ? "+" : "") + score.toFixed(1);
		const showStatus = activeStatus === "All";
		function toTitleCase(str) {
			return (str || "").replace(
				/\w\S*/g,
				(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
			);
		}
		const assigneeByMe =
			activeView === "byMe" && item.assignee_full_name
				? `<span class="wi-row-assignee">${frappe.utils.escape_html(
						toTitleCase(item.assignee_full_name)
				  )}</span>`
				: "";
		const assigneeToMe =
			activeView === "assigned" && item.assigned_by
				? `<span class="wi-row-assignee">${frappe.utils.escape_html(
						item.assigned_by
				  )}</span>`
				: "";

		return `<div class="wi-row" data-name="${item.name}">
		<button class="wi-row-main">
			<div class="wi-row-left">
				${chevronSvg}
				<span class="wi-row-id">${frappe.utils.escape_html(item.name)}</span>
				${priorityBars(priority)}
				<span class="wi-row-title">${frappe.utils.escape_html(item.summary || item.name)}</span>
				${inlineTags(item, timeGroup)}
			</div>
			<div class="wi-row-right">
				${assigneeByMe}
				${assigneeToMe}
				${
					showStatus
						? `<span class="wi-status-badge ${statusClass(item.status)}">${
								item.status
						  }</span>`
						: ""
				}
				<span class="wi-gap-value" style="color:${scoreColor}">${scoreDisplay}</span>
			</div>
		</button>
	</div>`;
	}

	// ── Render grouped list ──
	function renderList(items) {
		const listEl = $("#wi-task-list");
		const emptyEl = $("#wi-empty");

		if (!items.length) {
			listEl.innerHTML = "";
			emptyEl.style.display = "";
			return;
		}
		emptyEl.style.display = "none";

		let html = `<div class="wi-list">`;

		if (activeView === "assigned") {
			// Group by time
			const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], done: [] };
			items.forEach((it) => {
				if (it.status === "Done") {
					groups.done.push(it);
					return;
				}
				const group = classifyGroup(it);
				if (group === "later") return; // beyond the 30-day upcoming window, not shown
				groups[group].push(it);
			});
			Object.values(groups).forEach((arr) =>
				arr.sort((a, b) =>
					(a.target_end_date || "").localeCompare(b.target_end_date || "")
				)
			);
			const sectionMeta = {
				overdue: {
					label: "OVERDUE",
					sub: "Past due",
					accent: "var(--p-high)",
					cls: "wi-section-overdue",
				},
				today: {
					label: "TODAY",
					sub: friendlyDate(todayStr()),
					accent: "var(--c-review)",
					cls: "",
				},
				tomorrow: {
					label: "TOMORROW",
					sub: friendlyDate(tomorrowStr()),
					accent: "var(--c-open)",
					cls: "",
				},
				upcoming: {
					label: "UPCOMING",
					sub: "",
					accent: "var(--c-done)",
					cls: "",
				},
				done: { label: "DONE", sub: "Completed", accent: "var(--text-3)", cls: "" },
			};
			for (const key of ["overdue", "today", "tomorrow", "upcoming", "done"]) {
				if (!groups[key].length) continue;
				html += renderSection(key, sectionMeta[key], groups[key], key);
			}
		} else {
			// Same time-based grouping as assigned-to-me
			const groups = { overdue: [], today: [], tomorrow: [], upcoming: [], done: [] };
			items.forEach((it) => {
				if (it.status === "Done") {
					groups.done.push(it);
					return;
				}
				const group = classifyGroup(it);
				if (group === "later") return; // beyond the 30-day upcoming window, not shown
				groups[group].push(it);
			});
			Object.values(groups).forEach((arr) =>
				arr.sort((a, b) =>
					(a.target_end_date || "").localeCompare(b.target_end_date || "")
				)
			);
			const sectionMeta = {
				overdue: {
					label: "OVERDUE",
					sub: "Past due",
					accent: "var(--p-high)",
					cls: "wi-section-overdue",
				},
				today: {
					label: "TODAY",
					sub: friendlyDate(todayStr()),
					accent: "var(--c-review)",
					cls: "",
				},
				tomorrow: {
					label: "TOMORROW",
					sub: friendlyDate(tomorrowStr()),
					accent: "var(--c-open)",
					cls: "",
				},
				upcoming: {
					label: "UPCOMING",
					sub: "",
					accent: "var(--c-done)",
					cls: "",
				},
				done: { label: "DONE", sub: "Completed", accent: "var(--text-3)", cls: "" },
			};
			for (const key of ["overdue", "today", "tomorrow", "upcoming", "done"]) {
				if (!groups[key].length) continue;
				html += renderSection(key, sectionMeta[key], groups[key], key);
			}
		}

		html += `</div>`;
		listEl.innerHTML = html;
		bindRowEvents(listEl);
	}

	// ── Render one collapsible section ──
	function renderSection(key, meta, items, timeGroup, startCollapsed) {
		return `<div class="wi-section">
		<button class="wi-section-header ${meta.cls}" style="--section-accent:${
			meta.accent
		}" data-section="${key}">
			<div class="wi-section-left">
				<span class="wi-section-title" style="color:${meta.accent}">${meta.label}</span>
				<span class="wi-section-sub">${meta.sub}</span>
				<span class="wi-section-count">${items.length}</span>
			</div>
			<svg class="wi-chevron ${
				startCollapsed ? "" : "wi-chevron-open"
			}" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
		</button>
		<div class="wi-section-body ${startCollapsed ? "collapsed" : ""}" data-section-body="${key}">
			${items.map((it) => renderRow(it, timeGroup)).join("")}
		</div>
	</div>`;
	}

	// ── Row & section event bindings ──
	function bindRowEvents(listEl) {
		// Section collapse toggle
		listEl.querySelectorAll(".wi-section-header").forEach((btn) => {
			btn.addEventListener("click", () => {
				const key = btn.dataset.section;
				const body = listEl.querySelector(`[data-section-body="${key}"]`);
				const chevron = btn.querySelector(".wi-chevron");
				const collapsed = body.classList.toggle("collapsed");
				chevron.classList.toggle("wi-chevron-open", !collapsed);
			});
		});

		// Row expand/collapse (desktop: inline accordion. Mobile: bottom-sheet
		// popup instead — same content via renderExpanded either way, see
		// openRowDetailModal.)
		listEl.querySelectorAll(".wi-row-main").forEach((btn) => {
			btn.addEventListener("click", () => {
				const row = btn.closest(".wi-row");
				const name = row.dataset.name;

				if (isMobileViewport()) {
					const itemData = allItems.find((it) => it.name === name);
					if (itemData) openRowDetailModal(itemData);
					return;
				}

				const isExpanded = row.classList.contains("wi-row-expanded");

				// Collapse all rows
				listEl.querySelectorAll(".wi-row").forEach((r) => {
					r.classList.remove("wi-row-expanded");
					r.querySelector(".wi-row-chevron").classList.remove("wi-chevron-open");
					const panel = r.querySelector(".wi-expanded");
					if (panel) panel.remove();
				});

				if (!isExpanded) {
					row.classList.add("wi-row-expanded");
					row.querySelector(".wi-row-chevron").classList.add("wi-chevron-open");
					const itemData = allItems.find((it) => it.name === name);
					if (itemData) row.insertAdjacentHTML("beforeend", renderExpanded(itemData));
					bindExpandedActions(row);
				}
			});
		});
	}

	// ── Expanded panel action buttons ──
	function bindExpandedActions(row) {
		const openBtn = row.querySelector(".wi-action-open");
		if (openBtn)
			openBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				frappe.set_route("Form", "Work Item", openBtn.dataset.name);
			});
		const doneBtn = row.querySelector(".wi-action-done");
		if (doneBtn)
			doneBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				frappe.call({
					method: "frappe.client.set_value",
					args: {
						doctype: "Work Item",
						name: doneBtn.dataset.name,
						fieldname: "status",
						value: "Done",
					},
					callback: () => {
						closeRowModal();
						fetchItems();
					},
				});
			});
		const reviewBtn = row.querySelector(".wi-action-review");
		if (reviewBtn)
			reviewBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				frappe.call({
					method: "frappe.client.set_value",
					args: {
						doctype: "Work Item",
						name: reviewBtn.dataset.name,
						fieldname: "status",
						value: "Under Review",
					},
					callback: () => {
						closeRowModal();
						fetchItems();
					},
				});
			});
	}

	// fetchItems() rebuilds #wi-task-list, which incidentally clears the
	// desktop inline-expand as a side effect of the re-render — but the
	// mobile row-detail modal lives outside that list entirely, so it has
	// to be closed explicitly or it's left open showing stale data.
	function closeRowModal() {
		$("#wi-row-modal-backdrop")?.classList.remove("open");
	}

	// ── Donut chart for All card ──
	function renderAllPie(counts) {
		const pieEl = $("#wi-all-pie");
		if (!pieEl) return;
		const slices = [
			{ key: "open", color: "var(--c-open)", val: counts.open },
			{ key: "under-review", color: "var(--c-review)", val: counts["under-review"] },
			{ key: "on-hold", color: "var(--c-onhold)", val: counts["on-hold"] },
			{ key: "rework", color: "var(--p-high)", val: counts.rework },
			{ key: "done", color: "var(--c-done)", val: counts.done },
		].filter((s) => s.val > 0);
		const total = slices.reduce((s, sl) => s + sl.val, 0);
		const cx = 32,
			cy = 32,
			r = 24,
			strokeW = 13,
			gapDeg = 2;
		if (!total) {
			pieEl.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>`;
			return;
		}

		const circumference = 2 * Math.PI * r;
		const gapFrac = gapDeg / 360;
		let startAngle = -90;
		let arcs = "";

		slices.forEach((sl) => {
			const frac = sl.val / total;
			const spanDeg = frac * 360 - gapDeg;
			if (spanDeg <= 0) {
				startAngle += frac * 360;
				return;
			}
			const start = (startAngle * Math.PI) / 180;
			const end = ((startAngle + spanDeg) * Math.PI) / 180;
			const x1 = cx + r * Math.cos(start);
			const y1 = cy + r * Math.sin(start);
			const x2 = cx + r * Math.cos(end);
			const y2 = cy + r * Math.sin(end);
			const large = spanDeg > 180 ? 1 : 0;
			arcs += `<path d="M${x1.toFixed(3)},${y1.toFixed(
				3
			)} A${r},${r} 0 ${large} 1 ${x2.toFixed(3)},${y2.toFixed(3)}" fill="none" stroke="${
				sl.color
			}" stroke-width="${strokeW}" stroke-linecap="round"/>`;
			startAngle += frac * 360;
		});

		pieEl.innerHTML = arcs;
	}

	// ── Compute counts & update header ──
	function updateCounts(items) {
		const counts = { all: 0, open: 0, "under-review": 0, "on-hold": 0, rework: 0, done: 0 };
		let totalScore = 0,
			scoredCount = 0;
		let todayCount = 0,
			overdueCount = 0;

		items.forEach((it) => {
			counts.all++;
			if (it.status === "Open") counts.open++;
			else if (it.status === "Under Review") counts["under-review"]++;
			else if (it.status === "On Hold") counts["on-hold"]++;
			else if (it.status === "Rework Needed") counts.rework++;
			else if (it.status === "Done") counts.done++;

			if (it.score != null && it.score !== 0) {
				totalScore += it.score;
				scoredCount++;
			}

			if (it.status !== "Done") {
				const g = classifyGroup(it);
				if (g === "today") todayCount++;
				else if (g === "overdue") overdueCount++;
			}
		});

		const setCount = (sel, val) => {
			const el = $(sel);
			if (el) el.textContent = val;
		};
		setCount("#count-all", counts.all);
		setCount("#count-open", counts.open);
		setCount("#count-under-review", counts["under-review"]);
		setCount("#count-on-hold", counts["on-hold"]);
		setCount("#count-rework", counts.rework);
		setCount("#count-done", counts.done);

		// Pie chart on All card
		renderAllPie(counts);

		// Avg score
		const avgEl = $("#count-avg-score");
		if (avgEl) {
			avgEl.classList.remove("score-negative", "score-positive", "score-zero");
			if (scoredCount > 0) {
				const avg = totalScore / scoredCount;
				avgEl.textContent = avg.toFixed(1);
				avgEl.classList.add(
					avg < 0 ? "score-negative" : avg > 0 ? "score-positive" : "score-zero"
				);
			} else {
				avgEl.textContent = "—";
				avgEl.classList.add("score-zero");
			}
		}

		// Subtitle
		const subEl = $("#wi-subtitle");
		if (subEl) {
			let parts = [];
			if (todayCount)
				parts.push(`${todayCount} item${todayCount !== 1 ? "s" : ""} due today`);
			if (overdueCount) parts.push(`${overdueCount} overdue`);
			subEl.textContent = parts.length
				? "You have " + parts.join(" and ")
				: "All caught up!";
		}
	}

	// ── Apply filters ──
	function applyFilters() {
		let filtered = allItems;

		// Status filter
		if (activeStatus !== "All") {
			filtered = filtered.filter((it) => it.status === activeStatus);
		}

		renderList(filtered);
	}

	// ── Fetch data ──
	function fetchItems() {
		const mode = activeView === "byMe" ? "assigned_by_me" : "assigned_to_me";
		frappe.call({
			method: "taskstream.utils.get_dashboard_data",
			args: { mode: mode },
			async: true,
			callback: function (r) {
				allItems = r.message || [];

				// Update tab counts with ALL items (unfiltered)
				updateCounts(allItems);

				// Show content
				$("#wi-loading").style.display = "none";
				$("#wi-content").style.display = "";

				// Tab indicator: defer until browser has laid out the visible tabs
				requestAnimationFrame(() => positionTabIndicator($(".wi-tab.active")));

				applyFilters();
			},
			error: function () {
				$("#wi-loading").innerHTML =
					'<p style="color:#dc2626;text-align:center;padding:20px;">Failed to load work items.</p>';
			},
		});
	}

	// ── Event Bindings ──
	function bindEvents() {
		// Summary card (status filter) clicks
		$$(".wi-summary-card").forEach((card) => {
			card.addEventListener("click", () => {
				$$(".wi-summary-card").forEach((c) => c.classList.remove("active"));
				card.classList.add("active");
				activeStatus = card.dataset.status;
				applyFilters();
			});
		});

		// Assigned-to-me / Assigned-by-me toggle
		$$(".wi-tab").forEach((tab) => {
			tab.addEventListener("click", () => {
				$$(".wi-tab").forEach((t) => t.classList.remove("active"));
				tab.classList.add("active");
				activeView = tab.dataset.tab === "byMe" ? "byMe" : "assigned";
				positionTabIndicator(tab);
				fetchItems();
			});
		});
	}

	function positionTabIndicator(activeTab) {
		const indicator = $("#wi-tab-indicator");
		if (!indicator || !activeTab) return;
		indicator.style.width = activeTab.offsetWidth + "px";
		indicator.style.transform = "translateX(" + activeTab.offsetLeft + "px)";
	}

	// ── Init: set Open card active by default ──
	function setDefaultActiveCard() {
		$$(".wi-summary-card").forEach((c) => c.classList.remove("active"));
		const openCard = root_element.querySelector('.wi-summary-card[data-status="Open"]');
		if (openCard) openCard.classList.add("active");
	}

	bindEvents();
	setDefaultActiveCard();
	fetchItems();

	// Re-position tab indicator on resize / orientation change
	let _riTimer;
	window.addEventListener("resize", () => {
		clearTimeout(_riTimer);
		_riTimer = setTimeout(() => positionTabIndicator($(".wi-tab.active")), 100);
	});

	// ── Mobile row-detail popup: same renderExpanded content as desktop's
	// inline accordion, shown in a bottom sheet instead — desktop untouched. ──
	function isMobileViewport() {
		return window.matchMedia("(max-width: 560px)").matches;
	}

	function openRowDetailModal(itemData) {
		const backdrop = $("#wi-row-modal-backdrop");
		const body = $("#wi-row-modal-body");
		if (!backdrop || !body) return;
		body.innerHTML = renderExpanded(itemData);
		backdrop.classList.add("open");
		bindExpandedActions(body);
	}

	function setupMobileRowModal() {
		const backdrop = $("#wi-row-modal-backdrop");
		if (!backdrop) return;
		const close = () => backdrop.classList.remove("open");
		$("#wi-row-modal-close")?.addEventListener("click", close);
		backdrop.addEventListener("click", (e) => {
			if (e.target === backdrop) close();
		});
	}
	setupMobileRowModal();
})();
