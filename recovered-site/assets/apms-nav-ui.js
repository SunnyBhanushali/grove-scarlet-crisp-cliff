(function (root) {
  var KEY = "apms-ui-people-list-v1";
  var SESSION_KEY = "apms-ui-session-v1";
  var SESSION_KEYS = [
    "view",
    "kind",
    "currentMonth",
    "selectedPersonId",
    "selectedMonth",
    "selectedRoleId",
    "selectedTargetMonth",
    "selectedApmsId",
    "selectedAwardId",
    "selectedFunctionId",
    "selectedSbuId",
    "selectedBrandId",
    "selectedAgsId",
    "selectedPeriodId",
    "selectedRoleCaseId",
    "navHistory",
    "orgFilterBrandId",
    "peopleListFilter",
    "listFilter",
    "roleListFilter",
  ];
  var mem = null;
  var sessionMem = null;
  var bootSession = null;
  function load() {
    if (mem) return mem;
    try {
      var raw = sessionStorage.getItem(KEY);
      if (raw) mem = JSON.parse(raw);
    } catch (e) {}
    return mem || {};
  }
  function save(partial) {
    mem = Object.assign({}, load(), partial || {});
    try {
      sessionStorage.setItem(KEY, JSON.stringify(mem));
    } catch (e) {}
    return mem;
  }
  function pick(state) {
    var out = {};
    if (!state) return out;
    for (var i = 0; i < SESSION_KEYS.length; i++) {
      var k = SESSION_KEYS[i];
      if (Object.prototype.hasOwnProperty.call(state, k) && state[k] !== undefined) out[k] = state[k];
    }
    return out;
  }
  function freezeBoot(ui) {
    if (bootSession || !ui || !Object.keys(ui).length) return;
    bootSession = Object.assign({}, ui);
  }
  function loadSession() {
    if (!sessionMem) {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) sessionMem = pick(JSON.parse(raw));
      } catch (e) {}
    }
    freezeBoot(sessionMem);
    return Object.assign({}, sessionMem || {});
  }
  function saveSession(state) {
    sessionMem = pick(Object.assign({}, loadSession(), pick(state)));
    freezeBoot(sessionMem);
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionMem));
    } catch (e) {}
    return Object.assign({}, sessionMem);
  }
  function applySession(state) {
    var ui = bootSession || loadSession();
    return Object.assign({}, state || {}, ui);
  }
  function peopleFiltersStartOpen(person, saved) {
    if (typeof saved === "boolean") return saved;
    var a = person && person.access;
    return a === "admin" || a === "super_admin";
  }
  root.__apmsNavUi = {
    loadPeopleList: load,
    savePeopleList: save,
    loadSession: loadSession,
    saveSession: saveSession,
    applySession: applySession,
    peopleFiltersStartOpen: peopleFiltersStartOpen,
  };
})(typeof window !== "undefined" ? window : globalThis);
