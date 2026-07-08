const firebaseConfig = {
  apiKey: "AIzaSyDvUupOSdgGO3s_NPkEokkjY8AIakcO1kQ",
  authDomain: "xingqiang-accounting.firebaseapp.com",
  projectId: "xingqiang-accounting",
  storageBucket: "xingqiang-accounting.firebasestorage.app",
  messagingSenderId: "832171452365",
  appId: "1:832171452365:web:e0bc7cfc6836dbf16fc684",
  measurementId: "G-XF732DXQWH",
};

const COMPANY_SHORT_NAME = "興強科技";
const LOCAL_KEY = "xingqiang-accounting-state-v2";
const BOOTSTRAP_ADMIN_EMAIL = "opal860526@gmail.com";
const CURRENCIES = ["TWD", "USD", "EUR", "JPY", "CNY", "HKD", "GBP", "AUD", "CAD", "SGD"];
const SETTLEMENT_CYCLES = ["當下結", "月結", "雙月結", "半年結"];
const PERMISSION_LABELS = {
  viewDashboard: "查看總覽",
  viewTransactions: "查看帳款明細",
  keyinTransactions: "Keyin 新帳款",
  editTransactions: "修改帳款",
  deleteTransactions: "刪除帳款",
  recordPayments: "登記收付款",
  viewCustomers: "查看客戶主檔",
  manageCustomers: "新增/修改/刪除客戶",
  importExportExcel: "匯入/匯出 Excel",
  cloudSync: "雲端暫存",
  manageUsers: "管理人員權限",
};
const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);
const EMPLOYEE_DEFAULT_PERMISSIONS = [
  "viewDashboard",
  "viewTransactions",
  "keyinTransactions",
  "recordPayments",
  "viewCustomers",
  "importExportExcel",
];

let auth;
let db;
let unsubscribeAuth;
let dueChart;

const state = {
  customers: [],
  transactions: [],
  users: [],
  profile: null,
  user: null,
  cloudReady: false,
  dirty: false,
  editingTransactionId: "",
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();

  bindNavigation();
  bindEntryForm();
  bindPaymentForm();
  bindExcelTools();
  bindCustomerTools();
  bindUserTools();
  bindDetailTools();
  $("closeDueModalBtn").addEventListener("click", () => $("dueModal").classList.add("hidden"));

  await loadLocalOrSeed();
  setDefaultDates();
  renderAll();
  updateSaveStatus("公開使用");

  window.addEventListener("beforeunload", (event) => {
    event.preventDefault();
    event.returnValue = "關閉網站前，請先下載一份 Excel 備份到本機。";
  });
});

function bindNavigation() {
  document.querySelectorAll("[data-view], [data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view || button.dataset.viewJump));
  });
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  document.querySelectorAll(".nav-btn").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
}

function bindAuth() {
  $("signInBtn").addEventListener("click", async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (error) {
      showNotice(`Google 登入失敗：${friendlyFirebaseError(error)}`);
    }
  });

  $("signOutBtn").addEventListener("click", () => auth.signOut());

  unsubscribeAuth = auth.onAuthStateChanged(async (user) => {
    state.user = user;
    $("signInBtn").classList.toggle("hidden", !!user);
    $("signOutBtn").classList.toggle("hidden", !user);
    state.profile = null;
    if (user) {
      await ensureBootstrapAdmin(user);
      await loadUserProfile(user.email);
      if (can("manageUsers")) await loadUsers();
    }
    updateSaveStatus("公開使用");
    applyPermissions();
    renderUsers();
  });
}

function bindEntryForm() {
  $("tradeFlow").addEventListener("change", () => {
    $("accountSide").value = $("tradeFlow").value === "出口" ? "應收" : "應付";
  });

  $("customerSelect").addEventListener("change", async () => {
    const customer = state.customers.find((item) => item.customer_id === $("customerSelect").value);
    $("customerId").readOnly = !!customer;
    if (!customer) {
      $("customerId").value = "";
      $("counterparty").value = "";
      return;
    }
    $("customerId").value = customer.customer_id;
    $("counterparty").value = customer.english_name || "";
    $("currency").value = normalizeCurrency(customer.currency);
    $("settlementCycle").value = normalizeCycle(customer.settlement_cycle);
    $("graceDays").value = Number(customer.grace_days || 0);
    $("owner").value = customer.sales_person || "";
    await setExchangeRateForCurrency($("currency").value);
    updateEntryPreview();
  });

  $("currency").addEventListener("change", async () => {
    await setExchangeRateForCurrency($("currency").value);
    updateEntryPreview();
  });

  ["invoiceDate", "amountOriginal", "exchangeRate", "settlementCycle", "graceDays"].forEach((id) => {
    $(id).addEventListener("input", updateEntryPreview);
  });

  $("resetEntryBtn").addEventListener("click", resetEntryForm);

  $("entryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const isEditing = !!state.editingTransactionId;
    if (!isEditing && !can("keyinTransactions")) {
      showNotice("你目前沒有 keyin 帳款的權限。");
      return;
    }
    if (isEditing && !can("editTransactions")) {
      showNotice("你目前沒有修改帳款的權限。");
      return;
    }
    const amountOriginal = Number($("amountOriginal").value || 0);
    if (!$("counterparty").value.trim() || amountOriginal <= 0) {
      showNotice("請至少填寫客戶/供應商與金額。");
      return;
    }

    const existing = state.transactions.find((item) => item.id === state.editingTransactionId);
    const record = {
      id: existing?.id || crypto.randomUUID(),
      trade_flow: $("tradeFlow").value,
      account_side: $("accountSide").value,
      customer_id: $("customerId").value.trim(),
      counterparty: $("counterparty").value.trim(),
      invoice_no: $("invoiceNo").value.trim(),
      order_no: $("orderNo").value.trim(),
      shipment_no: $("shipmentNo").value.trim(),
      item_description: $("itemDescription").value.trim(),
      currency: normalizeCurrency($("currency").value),
      amount_original: amountOriginal,
      exchange_rate: Number($("exchangeRate").value || 1),
      settlement_cycle: normalizeCycle($("settlementCycle").value),
      invoice_date: $("invoiceDate").value,
      grace_days: Number($("graceDays").value || 0),
      paid_amount_twd: existing ? Number(existing.paid_amount_twd || 0) : 0,
      payment_date: existing?.payment_date || "",
      owner: $("owner").value.trim(),
      notes: $("notes").value.trim(),
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.transactions = [record, ...state.transactions.filter((item) => item.id !== record.id)];
    persistLocal();
    resetEntryForm();
    renderAll();
    showNotice("已儲存帳款到本機暫存。若要雲端保存，請到 Excel 頁按「儲存雲端暫存」。", "muted");
  });
}

function bindPaymentForm() {
  $("paymentRecordSelect").addEventListener("change", () => {
    const record = enrichedTransactions().find((item) => item.id === $("paymentRecordSelect").value);
    $("paymentAmount").value = record ? record.outstanding_twd : "";
  });

  $("registerPaymentBtn").addEventListener("click", () => {
    if (!can("recordPayments")) {
      showNotice("你目前沒有登記收付款的權限。");
      return;
    }
    const id = $("paymentRecordSelect").value;
    const amount = Number($("paymentAmount").value || 0);
    const paymentDate = $("paymentDate").value || todayISO();
    const record = state.transactions.find((item) => item.id === id);
    if (!record || amount <= 0) {
      showNotice("請選擇未結帳款並填寫本次收/付款金額。");
      return;
    }
    const enriched = enrichTransaction(record);
    record.paid_amount_twd = Math.min(enriched.amount_twd, Number(record.paid_amount_twd || 0) + amount);
    record.payment_date = paymentDate;
    record.updated_at = new Date().toISOString();
    persistLocal();
    renderAll();
    showNotice(`已登記收付款日期：${paymentDate}`, "muted");
  });
}

function bindExcelTools() {
  $("downloadExcelBtn").addEventListener("click", () => downloadExcel(false));
  $("saveFolderBtn").addEventListener("click", () => downloadExcel(true));
  $("cloudSaveBtn").addEventListener("click", saveCloud);
  $("loadCloudBtn").addEventListener("click", loadCloud);
  $("excelUpload").addEventListener("change", importExcel);
}

function bindCustomerTools() {
  $("restoreSeedBtn").addEventListener("click", async () => {
    if (!can("manageCustomers")) {
      showNotice("你目前沒有管理客戶主檔的權限。");
      return;
    }
    state.customers = await fetchSeedCustomers();
    persistLocal();
    renderAll();
    showNotice("已重載內建 ERP 客戶清單。", "muted");
  });
  $("customerSearch").addEventListener("input", renderCustomers);
  $("detailSearch").addEventListener("input", renderDetails);
  $("editCustomerSelect").addEventListener("change", fillCustomerForm);
  $("newCustomerBtn").addEventListener("click", resetCustomerForm);
  $("deleteCustomerBtn").addEventListener("click", deleteCustomerFromForm);
  $("customerForm").addEventListener("submit", saveCustomerFromForm);
}

function bindUserTools() {
  renderPermissionCheckboxes();
  $("userRole").addEventListener("change", applyRoleDefaults);
  $("userForm").addEventListener("submit", saveUserFromForm);
  $("deleteUserBtn").addEventListener("click", deleteUserFromForm);
  $("resetUserBtn").addEventListener("click", resetUserForm);
}

function bindDetailTools() {
  $("loadRecordBtn").addEventListener("click", loadSelectedRecordForEdit);
  $("deleteRecordBtn").addEventListener("click", deleteSelectedRecord);
}

async function loadLocalOrSeed() {
  const local = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
  state.customers = Array.isArray(local.customers) ? local.customers : [];
  state.transactions = Array.isArray(local.transactions) ? local.transactions : [];
  if (!state.customers.length) {
    state.customers = await fetchSeedCustomers();
    persistLocal(false);
  }
  if (!state.transactions.length) {
    state.transactions = buildDemoTransactions();
    persistLocal(false);
  }
}

async function fetchSeedCustomers() {
  const response = await fetch("./customer_seed.json", { cache: "no-store" });
  if (!response.ok) throw new Error("無法載入內建 ERP 客戶清單");
  const data = await response.json();
  return data.customers.map(normalizeCustomer);
}

async function ensureBootstrapAdmin(user) {
  if (emailKey(user.email) !== BOOTSTRAP_ADMIN_EMAIL) return;
  const profile = defaultAdminProfile(user.email);
  try {
    await db.collection("accounts").doc("xingqiang").collection("users").doc(emailKey(user.email)).set(profile, { merge: true });
  } catch (error) {
    state.profile = profile;
  }
}

async function loadUserProfile(email) {
  const normalizedEmail = emailKey(email);
  try {
    const doc = await db.collection("accounts").doc("xingqiang").collection("users").doc(normalizedEmail).get();
    if (doc.exists) {
      state.profile = doc.data();
    } else if (normalizedEmail === BOOTSTRAP_ADMIN_EMAIL) {
      state.profile = defaultAdminProfile(normalizedEmail);
    } else {
      state.profile = null;
      showNotice("這個 Google 帳號尚未被管理員加入人員權限，暫時只能使用本機暫存。");
    }
  } catch (error) {
    if (normalizedEmail === BOOTSTRAP_ADMIN_EMAIL) state.profile = defaultAdminProfile(normalizedEmail);
    showNotice(`讀取人員權限失敗：${friendlyFirebaseError(error)}`);
  }
}

async function loadUsers() {
  try {
    const snapshot = await db.collection("accounts").doc("xingqiang").collection("users").get();
    state.users = snapshot.docs.map((doc) => doc.data()).sort((a, b) => emailKey(a.email).localeCompare(emailKey(b.email)));
  } catch (error) {
    state.users = state.profile ? [state.profile] : [];
  }
}

function defaultAdminProfile(email) {
  return {
    email: emailKey(email),
    role: "admin",
    permissions: permissionMap(ALL_PERMISSIONS),
    updated_at: new Date().toISOString(),
  };
}

function defaultEmployeeProfile(email) {
  return {
    email: emailKey(email),
    role: "employee",
    permissions: permissionMap(EMPLOYEE_DEFAULT_PERMISSIONS),
    updated_at: new Date().toISOString(),
  };
}

function permissionMap(enabledKeys) {
  return ALL_PERMISSIONS.reduce((output, key) => {
    output[key] = enabledKeys.includes(key);
    return output;
  }, {});
}

function can(permission) {
  return true;
}

function applyPermissions() {
  const viewPermissions = {
    dashboard: "viewDashboard",
    entry: "keyinTransactions",
    payments: "recordPayments",
    details: "viewTransactions",
    customers: "viewCustomers",
    users: "manageUsers",
    excel: "importExportExcel",
  };
  document.querySelectorAll(".nav-btn").forEach((button) => {
    const allowed = can(viewPermissions[button.dataset.view]);
    button.classList.toggle("locked", !allowed);
    button.disabled = !allowed;
  });
  setFormDisabled("entryForm", !can("keyinTransactions") && !can("editTransactions"));
  setFormDisabled("customerForm", !can("manageCustomers"));
  setFormDisabled("userForm", !can("manageUsers"));
  $("restoreSeedBtn").disabled = !can("manageCustomers");
  $("registerPaymentBtn").disabled = !can("recordPayments");
  $("loadRecordBtn").disabled = !can("editTransactions");
  $("deleteRecordBtn").disabled = !can("deleteTransactions");
  $("cloudSaveBtn").disabled = !can("cloudSync");
  $("loadCloudBtn").disabled = !can("cloudSync");
  $("excelUpload").disabled = !can("importExportExcel");
  $("downloadExcelBtn").disabled = !can("importExportExcel");
  $("saveFolderBtn").disabled = !can("importExportExcel");

  const activeView = document.querySelector(".view.active")?.id || "dashboard";
  if (!can(viewPermissions[activeView])) showView("dashboard");
}

function setFormDisabled(formId, disabled) {
  document.querySelectorAll(`#${formId} input, #${formId} select, #${formId} textarea, #${formId} button`).forEach((element) => {
    element.disabled = disabled;
  });
}

function emailKey(email) {
  return String(email || "").trim().toLowerCase();
}

function persistLocal(markDirty = true) {
  localStorage.setItem(
    LOCAL_KEY,
    JSON.stringify({
      customers: state.customers,
      transactions: state.transactions,
      saved_at: new Date().toISOString(),
    })
  );
  if (markDirty) {
    state.dirty = true;
    updateSaveStatus("本機已更新");
  }
}

async function saveCloud() {
  if (!can("cloudSync")) {
    showNotice("你目前沒有雲端暫存的權限。");
    return;
  }
  try {
    await replaceCloudCollection("customers", state.customers, "customer_id");
    await replaceCloudCollection("transactions", state.transactions, "id");
    state.dirty = false;
    updateSaveStatus(`雲端已儲存：${new Date().toLocaleString("zh-TW")}`);
    showNotice("已儲存到 Firebase 雲端暫存。", "muted");
  } catch (error) {
    showNotice(`雲端儲存失敗：${friendlyFirebaseError(error)}`);
  }
}

async function loadCloud() {
  if (!can("cloudSync")) {
    showNotice("你目前沒有讀取雲端暫存的權限。");
    return;
  }
  try {
    const [customers, transactions] = await Promise.all([readCloudCollection("customers"), readCloudCollection("transactions")]);
    state.customers = customers.length ? customers.map(normalizeCustomer) : await fetchSeedCustomers();
    state.transactions = transactions.length ? transactions : buildDemoTransactions();
    persistLocal(false);
    state.dirty = false;
    renderAll();
    updateSaveStatus("已讀取雲端暫存");
    showNotice("已讀取 Firebase 雲端暫存。", "muted");
  } catch (error) {
    showNotice(`讀取雲端失敗：${friendlyFirebaseError(error)}`);
  }
}

async function replaceCloudCollection(collectionName, rows, idField) {
  const collection = db.collection("accounts").doc("xingqiang").collection(collectionName);
  const existing = await collection.get();
  let batch = db.batch();
  let count = 0;

  for (const doc of existing.docs) {
    batch.delete(doc.ref);
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  for (const row of rows) {
    const id = String(row[idField] || crypto.randomUUID());
    batch.set(collection.doc(id), row);
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

async function readCloudCollection(collectionName) {
  const snapshot = await db.collection("accounts").doc("xingqiang").collection(collectionName).get();
  return snapshot.docs.map((doc) => doc.data());
}

function renderAll() {
  renderCustomerSelect();
  renderMetrics();
  renderDueChart();
  renderUpcoming();
  renderRecent();
  renderPayments();
  renderDetails();
  renderCustomers();
  renderUsers();
  updateEntryPreview();
  applyPermissions();
  checkDueSoonAlert();
}

function renderCustomerSelect() {
  const selected = $("customerSelect").value;
  const options = [`<option value="">手動輸入</option>`].concat(
    [...state.customers]
      .sort((a, b) => (a.english_name || "").localeCompare(b.english_name || ""))
      .map((customer) => {
        const label = `${customer.english_name} (${customer.customer_id}) | ${normalizeCurrency(customer.currency)} | ${normalizeCycle(customer.settlement_cycle)}+${Number(customer.grace_days || 0)}天`;
        return `<option value="${escapeHtml(customer.customer_id)}">${escapeHtml(label)}</option>`;
      })
  );
  $("customerSelect").innerHTML = options.join("");
  $("customerSelect").value = selected;
}

function renderMetrics() {
  const rows = enrichedTransactions();
  const receivable = sum(rows.filter((row) => row.account_side === "應收"), "outstanding_twd");
  const payable = sum(rows.filter((row) => row.account_side === "應付"), "outstanding_twd");
  const overdue = sum(rows.filter((row) => row.days_overdue > 0), "outstanding_twd");
  $("metricReceivable").textContent = money(receivable);
  $("metricPayable").textContent = money(payable);
  $("metricOverdue").textContent = money(overdue);
  $("metricCustomers").textContent = state.customers.length.toLocaleString("zh-TW");
}

function renderDueChart() {
  const rows = enrichedTransactions().filter((row) => row.outstanding_twd > 0);
  const buckets = {
    "逾期": 0,
    "7天內": 0,
    "8-14天": 0,
    "15-30天": 0,
    "30天後": 0,
  };
  rows.forEach((row) => {
    const daysUntilDue = daysBetween(todayISO(), row.due_date);
    if (daysUntilDue < 0) buckets["逾期"] += row.outstanding_twd;
    else if (daysUntilDue <= 7) buckets["7天內"] += row.outstanding_twd;
    else if (daysUntilDue <= 14) buckets["8-14天"] += row.outstanding_twd;
    else if (daysUntilDue <= 30) buckets["15-30天"] += row.outstanding_twd;
    else buckets["30天後"] += row.outstanding_twd;
  });

  const ctx = $("dueChart");
  const data = {
    labels: Object.keys(buckets),
    datasets: [
      {
        label: "未結金額",
        data: Object.values(buckets),
        backgroundColor: ["#b83c3c", "#b56f16", "#d6a84f", "#5f8f86", "#1f6b5f"],
        borderWidth: 0,
      },
    ],
  };
  if (dueChart) {
    dueChart.data = data;
    dueChart.update();
    return;
  }
  dueChart = new Chart(ctx, {
    type: "bar",
    data,
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => ` ${money(context.raw)}` } },
      },
      scales: {
        y: { ticks: { callback: (value) => money(value) } },
      },
    },
  });
}

function renderUpcoming() {
  const rows = enrichedTransactions()
    .filter((row) => row.outstanding_twd > 0)
    .map((row) => ({ ...row, days_until_due: daysBetween(todayISO(), row.due_date) }))
    .filter((row) => row.days_until_due <= 30)
    .sort((a, b) => a.days_until_due - b.days_until_due)
    .slice(0, 10);
  renderTable($("upcomingTable"), [
    ["due_date", "到期日"],
    ["days_until_due", "剩餘天數"],
    ["customer_id", "客戶編號"],
    ["counterparty", "客戶/供應商"],
    ["account_side", "應收/應付"],
    ["outstanding_twd", "未結金額", money],
  ], rows);
}

function dueSoonRows() {
  return enrichedTransactions()
    .filter((row) => row.outstanding_twd > 0)
    .map((row) => ({ ...row, days_until_due: daysBetween(todayISO(), row.due_date) }))
    .filter((row) => row.days_until_due <= 7)
    .sort((a, b) => a.days_until_due - b.days_until_due);
}

function checkDueSoonAlert() {
  const rows = dueSoonRows();
  if (!rows.length) return;
  const alertKey = `${todayISO()}::${rows.map((row) => row.id).join(",")}`;
  if (sessionStorage.getItem("xingqiang-due-alert") === alertKey) return;
  sessionStorage.setItem("xingqiang-due-alert", alertKey);
  renderTable($("dueAlertTable"), [
    ["due_date", "到期日"],
    ["days_until_due", "剩餘天數"],
    ["customer_id", "客戶編號"],
    ["counterparty", "客戶/供應商"],
    ["account_side", "應收/應付"],
    ["invoice_no", "發票號碼"],
    ["outstanding_twd", "未結金額", money],
  ], rows);
  $("dueModal").classList.remove("hidden");
}

function renderRecent() {
  const rows = enrichedTransactions().slice(0, 8);
  renderTable($("recentTable"), [
    ["computed_status", "狀態"],
    ["invoice_date", "交易日期"],
    ["customer_id", "客戶編號"],
    ["counterparty", "客戶/供應商"],
    ["account_side", "應收/應付"],
    ["currency", "幣別"],
    ["amount_twd", "台幣金額", money],
    ["outstanding_twd", "未結金額", money],
    ["due_date", "到期日"],
  ], rows);
}

function renderPayments() {
  const rows = enrichedTransactions();
  const outstanding = rows.filter((row) => row.outstanding_twd > 0);
  $("paymentRecordSelect").innerHTML = outstanding.length
    ? outstanding.map((row) => `<option value="${row.id}">${escapeHtml(`${row.due_date} | ${row.account_side} | ${row.customer_id || ""} ${row.counterparty} | 未結 ${money(row.outstanding_twd)}`)}</option>`).join("")
    : `<option value="">沒有未結帳款</option>`;
  if (outstanding.length) $("paymentAmount").value = outstanding[0].outstanding_twd;
  $("paymentDate").value = $("paymentDate").value || todayISO();

  renderTable($("paidTable"), [
    ["computed_status", "狀態"],
    ["account_side", "應收/應付"],
    ["customer_id", "客戶編號"],
    ["counterparty", "客戶/供應商"],
    ["invoice_no", "發票號碼"],
    ["payment_date", "收付款日期"],
    ["paid_amount_twd", "已收/已付金額", money],
    ["outstanding_twd", "未結金額", money],
    ["amount_twd", "台幣金額", money],
  ], rows.filter((row) => Number(row.paid_amount_twd || 0) > 0));
}

function renderDetails() {
  const query = $("detailSearch").value.trim().toLowerCase();
  const rows = enrichedTransactions().filter((row) => {
    if (!query) return true;
    return [row.customer_id, row.counterparty, row.invoice_no, row.order_no, row.shipment_no]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  renderTable($("detailTable"), [
    ["computed_status", "狀態"],
    ["trade_flow", "進出口"],
    ["account_side", "應收/應付"],
    ["customer_id", "客戶編號"],
    ["counterparty", "客戶/供應商"],
    ["invoice_no", "發票號碼"],
    ["currency", "幣別"],
    ["amount_original", "原幣金額", money],
    ["exchange_rate", "匯率"],
    ["amount_twd", "台幣金額", money],
    ["settlement_cycle", "結帳方式"],
    ["grace_days", "付款天數"],
    ["due_date", "到期日"],
    ["payment_date", "收付款日期"],
    ["paid_amount_twd", "已收/已付金額", money],
    ["outstanding_twd", "未結金額", money],
    ["days_overdue", "逾期天數"],
    ["owner", "承辦人"],
  ], rows);
  renderEditRecordSelect(rows);
}

function renderEditRecordSelect(rows = enrichedTransactions()) {
  $("editRecordSelect").innerHTML = rows.length
    ? rows.map((row) => `<option value="${row.id}">${escapeHtml(`${row.invoice_date} | ${row.customer_id || ""} ${row.counterparty} | ${row.invoice_no || "無發票"} | ${money(row.outstanding_twd)}`)}</option>`).join("")
    : `<option value="">沒有帳款</option>`;
}

function loadSelectedRecordForEdit() {
  const id = $("editRecordSelect").value;
  const record = state.transactions.find((item) => item.id === id);
  if (!record) return;
  if (!can("editTransactions")) {
    showNotice("你目前沒有修改帳款的權限。");
    return;
  }
  state.editingTransactionId = id;
  $("customerSelect").value = record.customer_id || "";
  $("customerId").value = record.customer_id || "";
  $("customerId").readOnly = !!record.customer_id;
  $("counterparty").value = record.counterparty || "";
  $("invoiceDate").value = record.invoice_date || todayISO();
  $("tradeFlow").value = record.trade_flow || "出口";
  $("accountSide").value = record.account_side || "應收";
  $("invoiceNo").value = record.invoice_no || "";
  $("currency").value = normalizeCurrency(record.currency);
  $("amountOriginal").value = record.amount_original || 0;
  $("exchangeRate").value = record.exchange_rate || 1;
  $("settlementCycle").value = normalizeCycle(record.settlement_cycle);
  $("graceDays").value = record.grace_days || 0;
  $("orderNo").value = record.order_no || "";
  $("shipmentNo").value = record.shipment_no || "";
  $("itemDescription").value = record.item_description || "";
  $("owner").value = record.owner || "";
  $("notes").value = record.notes || "";
  updateEntryPreview();
  showView("entry");
  showNotice("已載入帳款到表單，修改後按「儲存帳款」。", "muted");
}

function deleteSelectedRecord() {
  const id = $("editRecordSelect").value;
  if (!id) return;
  if (!can("deleteTransactions")) {
    showNotice("你目前沒有刪除帳款的權限。");
    return;
  }
  state.transactions = state.transactions.filter((item) => item.id !== id);
  persistLocal();
  renderAll();
  showNotice("已刪除帳款。", "muted");
}

function renderCustomers() {
  const query = $("customerSearch").value.trim().toLowerCase();
  const rows = state.customers.filter((customer) => {
    if (!query) return true;
    return [customer.customer_id, customer.english_name, customer.currency, customer.sales_person]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  renderTable($("customerTable"), [
    ["customer_id", "客戶編號"],
    ["english_name", "客戶英文名稱"],
    ["currency", "幣別"],
    ["credit_days", "ERP信用天數"],
    ["settlement_cycle", "結帳方式"],
    ["grace_days", "付款天數"],
    ["payment_terms", "付款條件"],
    ["sales_person", "業務"],
    ["business_type", "客戶類別"],
    ["shipment_terms", "出貨條件"],
  ], rows);
  renderEditCustomerSelect();
}

function renderEditCustomerSelect() {
  const selected = $("editCustomerSelect").value;
  $("editCustomerSelect").innerHTML = `<option value="">新增客戶</option>` + [...state.customers]
    .sort((a, b) => (a.english_name || "").localeCompare(b.english_name || ""))
    .map((customer) => `<option value="${escapeHtml(customer.customer_id)}">${escapeHtml(`${customer.customer_id} | ${customer.english_name}`)}</option>`)
    .join("");
  $("editCustomerSelect").value = selected;
}

function fillCustomerForm() {
  const customer = state.customers.find((item) => item.customer_id === $("editCustomerSelect").value);
  if (!customer) {
    resetCustomerForm();
    return;
  }
  $("editCustomerId").value = customer.customer_id;
  $("editEnglishName").value = customer.english_name;
  $("editCustomerCurrency").value = normalizeCurrency(customer.currency);
  $("editCreditDays").value = customer.credit_days || 0;
  $("editSettlementCycle").value = normalizeCycle(customer.settlement_cycle);
  $("editGraceDays").value = customer.grace_days || 0;
  $("editSalesPerson").value = customer.sales_person || "";
  $("editBusinessType").value = customer.business_type || "";
  $("editShipmentTerms").value = customer.shipment_terms || "";
  $("editPaymentTerms").value = customer.payment_terms || "";
}

function resetCustomerForm() {
  $("customerForm").reset();
  $("editCustomerSelect").value = "";
  $("editCustomerCurrency").value = "TWD";
  $("editSettlementCycle").value = "月結";
}

function saveCustomerFromForm(event) {
  event.preventDefault();
  if (!can("manageCustomers")) {
    showNotice("你目前沒有管理客戶主檔的權限。");
    return;
  }
  const customer = normalizeCustomer({
    customer_id: $("editCustomerId").value,
    english_name: $("editEnglishName").value,
    currency: $("editCustomerCurrency").value,
    credit_days: Number($("editCreditDays").value || 0),
    settlement_cycle: $("editSettlementCycle").value,
    grace_days: Number($("editGraceDays").value || 0),
    payment_terms: $("editPaymentTerms").value,
    sales_person: $("editSalesPerson").value,
    business_type: $("editBusinessType").value,
    shipment_terms: $("editShipmentTerms").value,
  });
  if (!customer.customer_id || !customer.english_name) {
    showNotice("客戶編號與英文名稱必填。");
    return;
  }
  upsertCustomers([customer]);
  persistLocal();
  renderAll();
  $("editCustomerSelect").value = customer.customer_id;
  fillCustomerForm();
  showNotice("已儲存客戶主檔到本機暫存。", "muted");
}

function deleteCustomerFromForm() {
  if (!can("manageCustomers")) {
    showNotice("你目前沒有刪除客戶的權限。");
    return;
  }
  const customerId = $("editCustomerId").value.trim();
  if (!customerId) return;
  state.customers = state.customers.filter((customer) => customer.customer_id !== customerId);
  persistLocal();
  resetCustomerForm();
  renderAll();
  showNotice(`已刪除客戶 ${customerId}。`, "muted");
}

function renderPermissionCheckboxes() {
  $("permissionList").innerHTML = ALL_PERMISSIONS.map((key) => (
    `<label><input type="checkbox" value="${key}" data-permission="${key}" /> ${escapeHtml(PERMISSION_LABELS[key])}</label>`
  )).join("");
  applyRoleDefaults();
}

function applyRoleDefaults() {
  const role = $("userRole").value;
  const enabled = role === "admin" ? ALL_PERMISSIONS : EMPLOYEE_DEFAULT_PERMISSIONS;
  document.querySelectorAll("[data-permission]").forEach((checkbox) => {
    checkbox.checked = enabled.includes(checkbox.value);
    checkbox.disabled = role === "admin";
  });
}

function saveUserFromForm(event) {
  event.preventDefault();
  if (!can("manageUsers")) {
    showNotice("你目前沒有管理人員權限的權限。");
    return;
  }
  const email = emailKey($("userEmail").value);
  if (!email) return;
  const role = $("userRole").value;
  const enabled = role === "admin"
    ? ALL_PERMISSIONS
    : [...document.querySelectorAll("[data-permission]")].filter((box) => box.checked).map((box) => box.value);
  const profile = {
    email,
    role,
    permissions: permissionMap(enabled),
    updated_at: new Date().toISOString(),
  };
  upsertUser(profile);
}

async function upsertUser(profile) {
  const map = new Map(state.users.map((user) => [emailKey(user.email), user]));
  map.set(emailKey(profile.email), profile);
  state.users = [...map.values()].sort((a, b) => emailKey(a.email).localeCompare(emailKey(b.email)));
  renderUsers();
  try {
    if (!state.user) throw new Error("尚未登入 Google");
    await db.collection("accounts").doc("xingqiang").collection("users").doc(emailKey(profile.email)).set(profile, { merge: true });
    showNotice(`已儲存 ${profile.email} 的權限。`, "muted");
  } catch (error) {
    showNotice(`人員權限已暫存在本機畫面，但雲端儲存失敗：${friendlyFirebaseError(error)}`);
  }
}

async function deleteUserFromForm() {
  if (!can("manageUsers")) {
    showNotice("你目前沒有刪除人員的權限。");
    return;
  }
  const email = emailKey($("userEmail").value);
  if (!email || email === BOOTSTRAP_ADMIN_EMAIL) {
    showNotice("不能刪除預設管理員。");
    return;
  }
  state.users = state.users.filter((user) => emailKey(user.email) !== email);
  renderUsers();
  resetUserForm();
  try {
    await db.collection("accounts").doc("xingqiang").collection("users").doc(email).delete();
    showNotice(`已刪除 ${email}。`, "muted");
  } catch (error) {
    showNotice(`刪除雲端人員失敗：${friendlyFirebaseError(error)}`);
  }
}

function resetUserForm() {
  $("userForm").reset();
  $("userRole").value = "employee";
  applyRoleDefaults();
}

function fillUserForm(profile) {
  $("userEmail").value = profile.email || "";
  $("userRole").value = profile.role || "employee";
  document.querySelectorAll("[data-permission]").forEach((checkbox) => {
    checkbox.checked = profile.role === "admin" || !!profile.permissions?.[checkbox.value];
    checkbox.disabled = profile.role === "admin";
  });
}

function renderUsers() {
  if (!state.users.length && state.profile) state.users = [state.profile];
  const rows = state.users.map((user) => ({
    email: user.email,
    role_label: user.role === "admin" ? "管理員" : "員工",
    permission_summary: user.role === "admin"
      ? "全部權限"
      : ALL_PERMISSIONS.filter((key) => user.permissions?.[key]).map((key) => PERMISSION_LABELS[key]).join("、"),
    updated_at: user.updated_at || "",
  }));
  renderTable($("userTable"), [
    ["email", "Email"],
    ["role_label", "角色"],
    ["permission_summary", "權限"],
    ["updated_at", "更新時間"],
  ], rows);
  Array.from($("userTable").querySelectorAll("tbody tr")).forEach((row, index) => {
    row.addEventListener("click", () => fillUserForm(state.users[index]));
  });
}

function renderTable(table, columns, rows) {
  if (!rows.length) {
    table.innerHTML = $("emptyTableTemplate").innerHTML;
    return;
  }
  const header = `<thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead>`;
  const body = rows.map((row) => {
    const cells = columns.map(([field, , formatter]) => {
      const value = formatter ? formatter(row[field]) : row[field] ?? "";
      const className = field === "computed_status" && row[field] === "逾期" ? "status-danger" : "";
      return `<td class="${className}">${escapeHtml(value)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  table.innerHTML = `${header}<tbody>${body}</tbody>`;
}

function updateEntryPreview() {
  const amount = Number($("amountOriginal").value || 0);
  const rate = Number($("exchangeRate").value || 1);
  $("amountTwdPreview").textContent = money(amount * rate);
  $("dueDatePreview").textContent = calculateDueDate(
    $("invoiceDate").value || todayISO(),
    $("settlementCycle").value,
    Number($("graceDays").value || 0)
  );
}

async function setExchangeRateForCurrency(currency) {
  const normalized = normalizeCurrency(currency);
  if (normalized === "TWD") {
    $("exchangeRate").value = "1";
    return;
  }
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${normalized}`);
    const payload = await response.json();
    const rate = Number(payload?.rates?.TWD || 0);
    $("exchangeRate").value = rate > 0 ? rate.toFixed(4) : $("exchangeRate").value || "1";
  } catch {
    $("exchangeRate").value = $("exchangeRate").value || "1";
  }
}

function resetEntryForm() {
  state.editingTransactionId = "";
  $("entryForm").reset();
  $("customerId").readOnly = false;
  setDefaultDates();
  $("currency").value = "TWD";
  $("exchangeRate").value = "1";
  $("settlementCycle").value = "月結";
  updateEntryPreview();
}

function setDefaultDates() {
  $("invoiceDate").value = $("invoiceDate").value || todayISO();
  $("paymentDate").value = $("paymentDate").value || todayISO();
}

function enrichedTransactions() {
  return state.transactions.map(enrichTransaction).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
}

function enrichTransaction(record) {
  const amountOriginal = Number(record.amount_original || 0);
  const exchangeRate = Number(record.exchange_rate || 1);
  const amountTwd = Math.round(amountOriginal * exchangeRate * 100) / 100;
  const paid = Number(record.paid_amount_twd || 0);
  const dueDate = record.due_date || calculateDueDate(record.invoice_date, record.settlement_cycle, Number(record.grace_days || 0));
  const outstanding = Math.max(amountTwd - paid, 0);
  const overdue = outstanding > 0 ? Math.max(daysBetween(dueDate, todayISO()), 0) : 0;
  return {
    ...record,
    currency: normalizeCurrency(record.currency),
    settlement_cycle: normalizeCycle(record.settlement_cycle),
    amount_twd: amountTwd,
    due_date: dueDate,
    settlement_period: settlementPeriod(record.invoice_date, record.settlement_cycle),
    outstanding_twd: Math.round(outstanding * 100) / 100,
    days_overdue: overdue,
    computed_status: outstanding <= 0 ? "已結清" : overdue > 0 ? "逾期" : paid > 0 ? "部分" : "未結",
  };
}

function buildDemoTransactions() {
  const demoSpecs = [
    { id: "demo-overdue-asus", customerId: "CA0603N", invoiceNo: "DEMO-001", amount: 126000, paid: 30000, dueOffset: -3, note: "示範：已逾期且部分收款" },
    { id: "demo-week-aitken", customerId: "CA0686U", invoiceNo: "DEMO-002", amount: 68000, paid: 0, dueOffset: 3, note: "示範：3 天內到期" },
    { id: "demo-week-delta", customerId: "CD0687N", invoiceNo: "DEMO-003", amount: 52000, paid: 0, dueOffset: 6, note: "示範：一週內到期" },
    { id: "demo-month-ample", customerId: "CF0716U", invoiceNo: "DEMO-004", amount: 4200, paid: 0, dueOffset: 18, note: "示範：30 天內到期" },
    { id: "demo-paid-air", customerId: "CA0601N", invoiceNo: "DEMO-005", amount: 88000, paid: 88000, dueOffset: -1, note: "示範：已結清" },
  ];
  return demoSpecs.map((spec) => {
    const customer = state.customers.find((item) => item.customer_id === spec.customerId) || {};
    const currency = normalizeCurrency(customer.currency);
    const exchangeRate = currency === "USD" ? 32 : currency === "HKD" ? 4.1 : 1;
    const dueDate = addDays(todayISO(), spec.dueOffset);
    const graceDays = Number(customer.grace_days || Math.max(spec.dueOffset, 0));
    return {
      id: spec.id,
      trade_flow: "出口",
      account_side: "應收",
      customer_id: customer.customer_id || spec.customerId,
      counterparty: customer.english_name || spec.customerId,
      invoice_no: spec.invoiceNo,
      order_no: `SO-${spec.invoiceNo}`,
      shipment_no: "",
      item_description: "示範帳款",
      currency,
      amount_original: spec.amount,
      exchange_rate: exchangeRate,
      settlement_cycle: normalizeCycle(customer.settlement_cycle || "月結"),
      invoice_date: addDays(dueDate, -Math.max(graceDays, 1)),
      grace_days: graceDays,
      due_date: dueDate,
      paid_amount_twd: spec.paid,
      payment_date: spec.paid > 0 ? addDays(todayISO(), -1) : "",
      owner: customer.sales_person || "",
      notes: spec.note,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

function calculateDueDate(invoiceDate, settlementCycle, graceDays = 0) {
  const input = parseDate(invoiceDate);
  const cycle = normalizeCycle(settlementCycle);
  let base;
  if (cycle === "當下結") {
    base = input;
  } else if (cycle === "月結") {
    base = monthEnd(input.getFullYear(), input.getMonth());
  } else if (cycle === "雙月結") {
    const endMonth = Math.floor(input.getMonth() / 2) * 2 + 1;
    base = monthEnd(input.getFullYear(), endMonth);
  } else {
    base = new Date(input.getFullYear(), input.getMonth() <= 5 ? 5 : 11, input.getMonth() <= 5 ? 30 : 31);
  }
  base.setDate(base.getDate() + Math.max(Number(graceDays || 0), 0));
  return toISODate(base);
}

function settlementPeriod(invoiceDate, settlementCycle) {
  const date = parseDate(invoiceDate);
  const cycle = normalizeCycle(settlementCycle);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (cycle === "當下結") return toISODate(date);
  if (cycle === "月結") return `${year}-${String(month).padStart(2, "0")}`;
  if (cycle === "雙月結") {
    const start = Math.floor((month - 1) / 2) * 2 + 1;
    return `${year}-${String(start).padStart(2, "0")}/${String(start + 1).padStart(2, "0")}`;
  }
  return `${year}-${month <= 6 ? "H1" : "H2"}`;
}

function monthEnd(year, zeroBasedMonth) {
  return new Date(year, zeroBasedMonth + 1, 0);
}

function daysBetween(isoDate, today) {
  return Math.floor((parseDate(today) - parseDate(isoDate)) / 86400000);
}

function parseDate(value) {
  if (!value) return new Date();
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function todayISO() {
  return toISODate(new Date());
}

function addDays(isoDate, days) {
  const date = parseDate(isoDate);
  date.setDate(date.getDate() + Number(days || 0));
  return toISODate(date);
}

function toISODate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeCustomer(customer) {
  return {
    customer_id: String(customer.customer_id || "").trim(),
    english_name: String(customer.english_name || "").trim(),
    chinese_name: String(customer.chinese_name || "").trim(),
    currency: normalizeCurrency(customer.currency),
    credit_days: Number(customer.credit_days || 0),
    settlement_cycle: normalizeCycle(customer.settlement_cycle),
    grace_days: Number(customer.grace_days || 0),
    payment_terms: String(customer.payment_terms || "").trim(),
    sales_person: String(customer.sales_person || "").trim(),
    business_type: String(customer.business_type || "").trim(),
    shipment_terms: String(customer.shipment_terms || "").trim(),
    contact_person: String(customer.contact_person || "").trim(),
    phone: String(customer.phone || "").trim(),
    email: String(customer.email || "").trim(),
  };
}

function normalizeCurrency(value) {
  const text = String(value || "TWD").trim().toUpperCase();
  const aliases = { NTD: "TWD", NT: "TWD", RMB: "CNY", "台幣": "TWD", "新台幣": "TWD", "人民幣": "CNY" };
  const normalized = aliases[text] || text;
  return CURRENCIES.includes(normalized) ? normalized : "TWD";
}

function normalizeCycle(value) {
  const text = String(value || "月結").trim();
  return SETTLEMENT_CYCLES.includes(text) ? text : "月結";
}

function money(value) {
  return Number(value || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] || 0), 0);
}

function showNotice(message, mode = "") {
  const notice = $("cloudNotice");
  notice.textContent = message;
  notice.classList.toggle("muted", mode === "muted");
}

function updateSaveStatus(text) {
  $("saveStatus").textContent = text;
}

function friendlyFirebaseError(error) {
  const message = error?.message || String(error);
  if (message.includes("firestore.googleapis.com") || message.includes("PERMISSION_DENIED")) {
    return "Firestore 尚未啟用，或目前登入帳號沒有權限。請先在 Firebase Console 啟用 Firestore。";
  }
  if (message.includes("auth/operation-not-allowed")) {
    return "Firebase Authentication 尚未啟用 Google 登入。";
  }
  return message;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function importExcel(event) {
  if (!can("importExportExcel")) {
    showNotice("你目前沒有匯入 Excel 的權限。");
    event.target.value = "";
    return;
  }
  const file = event.target.files?.[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let importedCustomers = 0;
  let importedTransactions = 0;

  workbook.SheetNames.forEach((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    const parsedCustomers = parseCustomerRows(rows);
    if (parsedCustomers.length) {
      upsertCustomers(parsedCustomers);
      importedCustomers += parsedCustomers.length;
      return;
    }
    const parsedTransactions = parseTransactionRows(rows);
    if (parsedTransactions.length) {
      upsertTransactions(parsedTransactions);
      importedTransactions += parsedTransactions.length;
    }
  });

  persistLocal();
  renderAll();
  $("excelMessage").textContent = `已匯入 ${importedTransactions} 筆交易、${importedCustomers} 筆客戶資料。`;
  event.target.value = "";
}

function parseCustomerRows(rows) {
  return rows
    .map((row) => {
      const customerId = readAlias(row, ["Customer ID", "客戶編號", "customer_id"]);
      const englishName = readAlias(row, ["English name", "客戶英文名稱", "英文名稱", "english_name"]);
      if (!customerId || !englishName) return null;
      const creditDays = Number(readAlias(row, ["Credit days", "ERP信用天數", "信用天數", "credit_days"]) || 0);
      const terms = readAlias(row, ["Payment Terms", "付款條件", "payment_terms"]);
      const grace = Number(readAlias(row, ["付款天數", "grace_days"]) || inferDays(terms, creditDays));
      return normalizeCustomer({
        customer_id: customerId,
        english_name: englishName,
        chinese_name: readAlias(row, ["Chinese name", "中文名稱", "chinese_name"]),
        currency: readAlias(row, ["Currency", "幣別", "currency"]),
        credit_days: creditDays,
        settlement_cycle: readAlias(row, ["結帳方式", "settlement_cycle"]) || (grace <= 0 ? "當下結" : "月結"),
        grace_days: grace,
        payment_terms: terms,
        sales_person: readAlias(row, ["SalesPerson", "業務", "sales_person"]),
        business_type: readAlias(row, ["Bus. Type", "客戶類別", "business_type"]),
        shipment_terms: readAlias(row, ["Shipment Terms", "出貨條件", "shipment_terms"]),
        contact_person: readAlias(row, ["Contact Person", "聯絡人", "contact_person"]),
        phone: readAlias(row, ["Phone No.", "電話", "phone"]),
        email: readAlias(row, ["Email", "email"]),
      });
    })
    .filter(Boolean);
}

function parseTransactionRows(rows) {
  return rows
    .map((row) => {
      const counterparty = readAlias(row, ["客戶/供應商", "counterparty"]);
      const amount = Number(readAlias(row, ["原幣金額", "金額", "amount_original"]) || 0);
      if (!counterparty || amount <= 0) return null;
      const currency = normalizeCurrency(readAlias(row, ["幣別", "currency"]));
      return {
        id: readAlias(row, ["ID", "id"]) || crypto.randomUUID(),
        trade_flow: readAlias(row, ["進出口", "trade_flow"]) || "出口",
        account_side: readAlias(row, ["應收/應付", "account_side"]) || "應收",
        customer_id: readAlias(row, ["客戶編號", "Customer ID", "customer_id"]),
        counterparty,
        invoice_no: readAlias(row, ["發票號碼", "invoice_no"]),
        order_no: readAlias(row, ["訂單號碼", "order_no"]),
        shipment_no: readAlias(row, ["提單/報關號碼", "shipment_no"]),
        item_description: readAlias(row, ["品名/摘要", "item_description"]),
        currency,
        amount_original: amount,
        exchange_rate: Number(readAlias(row, ["匯率", "exchange_rate"]) || 1),
        settlement_cycle: normalizeCycle(readAlias(row, ["結帳方式", "settlement_cycle"])),
        invoice_date: normalizeSheetDate(readAlias(row, ["交易日期", "發票日期", "invoice_date"])) || todayISO(),
        grace_days: Number(readAlias(row, ["付款天數", "grace_days"]) || 0),
        paid_amount_twd: Number(readAlias(row, ["已收/已付金額", "paid_amount_twd"]) || 0),
        payment_date: normalizeSheetDate(readAlias(row, ["收付款日期", "payment_date"])),
        owner: readAlias(row, ["承辦人", "owner"]),
        notes: readAlias(row, ["備註", "notes"]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function upsertCustomers(customers) {
  const map = new Map(state.customers.map((customer) => [customer.customer_id, customer]));
  customers.forEach((customer) => map.set(customer.customer_id, customer));
  state.customers = [...map.values()];
}

function upsertTransactions(transactions) {
  const map = new Map(state.transactions.map((record) => [record.id, record]));
  transactions.forEach((record) => map.set(record.id, record));
  state.transactions = [...map.values()];
}

function readAlias(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== "") {
      return row[alias];
    }
  }
  return "";
}

function inferDays(terms, fallback) {
  const numbers = String(terms || "").match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : Number(fallback || 0);
}

function normalizeSheetDate(value) {
  if (!value) return "";
  if (value instanceof Date) return toISODate(value);
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return "";
    return toISODate(new Date(parsed.y, parsed.m - 1, parsed.d));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : toISODate(date);
}

async function downloadExcel(usePicker) {
  if (!can("importExportExcel")) {
    showNotice("你目前沒有匯出 Excel 的權限。");
    return;
  }
  const workbook = buildWorkbook();
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filename = `${COMPANY_SHORT_NAME}_對帳備份_${todayISO()}.xlsx`;

  if (usePicker && window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  state.dirty = false;
  updateSaveStatus(`已下載：${filename}`);
}

function buildWorkbook() {
  const rows = enrichedTransactions();
  const summary = [
    { 項目: "公司名稱", 數值: "興強科技有限公司", 說明: "" },
    { 項目: "報表日期", 數值: todayISO(), 說明: "" },
    { 項目: "交易筆數", 數值: rows.length, 說明: "" },
    { 項目: "ERP客戶筆數", 數值: state.customers.length, 說明: "" },
    { 項目: "應收未結", 數值: sum(rows.filter((row) => row.account_side === "應收"), "outstanding_twd"), 說明: "" },
    { 項目: "應付未結", 數值: sum(rows.filter((row) => row.account_side === "應付"), "outstanding_twd"), 說明: "" },
  ];
  const detail = rows.map((row) => ({
    ID: row.id,
    進出口: row.trade_flow,
    "應收/應付": row.account_side,
    客戶編號: row.customer_id,
    "客戶/供應商": row.counterparty,
    發票號碼: row.invoice_no,
    訂單號碼: row.order_no,
    "提單/報關號碼": row.shipment_no,
    "品名/摘要": row.item_description,
    幣別: row.currency,
    原幣金額: row.amount_original,
    匯率: row.exchange_rate,
    台幣金額: row.amount_twd,
    結帳方式: row.settlement_cycle,
    結帳期間: row.settlement_period,
    交易日期: row.invoice_date,
    付款天數: row.grace_days,
    到期日: row.due_date,
    "已收/已付金額": row.paid_amount_twd,
    收付款日期: row.payment_date,
    未結金額: row.outstanding_twd,
    逾期天數: row.days_overdue,
    承辦人: row.owner,
    備註: row.notes,
  }));
  const customers = state.customers.map((customer) => ({
    客戶編號: customer.customer_id,
    客戶英文名稱: customer.english_name,
    中文名稱: customer.chinese_name,
    幣別: customer.currency,
    ERP信用天數: customer.credit_days,
    結帳方式: customer.settlement_cycle,
    付款天數: customer.grace_days,
    付款條件: customer.payment_terms,
    業務: customer.sales_person,
    客戶類別: customer.business_type,
    出貨條件: customer.shipment_terms,
    聯絡人: customer.contact_person,
    電話: customer.phone,
    Email: customer.email,
  }));
  const aging = groupRows(rows, ["account_side", "computed_status"], "outstanding_twd", ["應收/應付", "狀態", "未結金額"]);
  const cycle = groupRows(rows, ["settlement_cycle", "settlement_period", "account_side"], "outstanding_twd", ["結帳方式", "結帳期間", "應收/應付", "未結金額"]);
  const counterparty = groupRows(rows, ["customer_id", "counterparty", "account_side"], "outstanding_twd", ["客戶編號", "客戶/供應商", "應收/應付", "未結金額"]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "對帳總表");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detail), "交易明細");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(customers), "ERP客戶主檔");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(aging), "帳齡分析");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cycle), "結帳週期");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(counterparty), "客戶供應商");
  return workbook;
}

function groupRows(rows, keys, valueField, labels) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keys.map((field) => row[field] || "").join("||");
    map.set(key, (map.get(key) || 0) + Number(row[valueField] || 0));
  });
  return [...map.entries()].map(([key, value]) => {
    const parts = key.split("||");
    const output = {};
    parts.forEach((part, index) => {
      output[labels[index]] = part;
    });
    output[labels[labels.length - 1]] = value;
    return output;
  });
}
