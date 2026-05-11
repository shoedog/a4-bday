(function () {
  const config = window.AVA_PARTY_CONFIG || {};
  const storageKey = "ava-jinks-4-rsvps";
  const codeStorageKey = "ava-jinks-4-party-code";
  const tokenStorageKey = "ava-jinks-4-rsvp-token";
  const event = {
    title: "Ava Jinks' 4th Birthday",
    location: "Centennial Center Park, 13050 E. Peakview Ave., Centennial, CO 80112",
    startLocal: "20260602T160000",
    endLocal: "20260602T190000",
    details:
      "Rainbow unicorn birthday party. Pizza, snacks, and drinks provided. Playground and splash pad fun; swimsuit and towel optional."
  };

  const elements = {
    form: document.querySelector("#rsvp-form"),
    status: document.querySelector("#rsvp-status"),
    guestItems: document.querySelector("#guest-items"),
    guestEmpty: document.querySelector("#guest-empty"),
    familyCount: document.querySelector("#family-count"),
    kidCount: document.querySelector("#kid-count"),
    adultCount: document.querySelector("#adult-count"),
    refreshButton: document.querySelector("#refresh-button"),
    storageMode: document.querySelector("#storage-mode"),
    calendarButton: document.querySelector("#calendar-button"),
    contactPhone: document.querySelector("#contact-phone"),
    contactEmail: document.querySelector("#contact-email"),
    inviteCode: document.querySelector("#invite-code"),
    inviteCodeField: document.querySelector("#invite-code-field"),
    guestCode: document.querySelector("#guest-code"),
    guestCodeForm: document.querySelector("#guest-code-form")
  };

  let supabaseClient = null;
  let backendMode = "unavailable";

  init();

  function init() {
    hydrateContact();
    hydrateInviteCode();
    configureBackend();

    elements.form.addEventListener("submit", onSubmit);
    elements.refreshButton.addEventListener("click", loadAndRender);
    elements.calendarButton.addEventListener("click", downloadCalendarInvite);
    elements.guestCodeForm.addEventListener("submit", onGuestCodeSubmit);
    elements.inviteCode.addEventListener("input", () => syncInviteCode(elements.inviteCode.value, "form"));
    elements.guestCode.addEventListener("input", () => syncInviteCode(elements.guestCode.value, "guest"));

    loadAndRender();
  }

  function hydrateContact() {
    if (config.contactPhone && elements.contactPhone) {
      elements.contactPhone.textContent = config.contactPhone;
    }
    if (config.contactPhoneHref && elements.contactPhone) {
      elements.contactPhone.href = "tel:" + config.contactPhoneHref.replace(/[^\d+]/g, "");
    }
    if (config.contactEmail && elements.contactEmail) {
      elements.contactEmail.textContent = config.contactEmail;
      elements.contactEmail.href = "mailto:" + config.contactEmail;
    }
  }

  function hydrateInviteCode() {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const codeFromUrl =
      cleanText(url.searchParams.get("code")) ||
      cleanText(url.searchParams.get("party")) ||
      cleanText(hashParams.get("code"));
    const code = codeFromUrl || cleanText(sessionStorage.getItem(codeStorageKey));

    syncInviteCode(code, "init");

    if (codeFromUrl) {
      persistInviteCode(codeFromUrl);
      setCodeFieldsVisible(false);
    }
  }

  function configureBackend() {
    const hasSupabase =
      Boolean(config.supabaseUrl) &&
      Boolean(config.supabaseAnonKey) &&
      window.supabase &&
      typeof window.supabase.createClient === "function";

    if (hasSupabase) {
      backendMode = "supabase";
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
      elements.storageMode.textContent = getInviteCode()
        ? "Shared RSVP list is connected."
        : "Use the link from the school email to RSVP.";
      return;
    }

    if (config.allowLocalDemo === true) {
      backendMode = "local";
      elements.storageMode.textContent =
        "Demo mode: RSVPs are saved in this browser until Supabase is configured.";
      return;
    }

    backendMode = "unavailable";
    setFormDisabled(true);
    setStatus("RSVPs are not available until the shared RSVP backend is configured.", true);
    elements.storageMode.textContent = "Shared RSVP backend is not configured.";
  }

  async function onSubmit(eventInfo) {
    eventInfo.preventDefault();

    if (backendMode === "unavailable") {
      setStatus("RSVPs are not available yet. Please contact the host.", true);
      return;
    }

    const formData = new FormData(elements.form);
    const inviteCode = cleanText(formData.get("inviteCode"));
    const attending = formData.get("attending") === "yes";
    const guestName = cleanText(formData.get("guestName"));
    const adults = attending ? clampNumber(formData.get("adults"), 0, 12) : 0;
    const children = attending ? clampNumber(formData.get("children"), 0, 12) : 0;

    if (!guestName) {
      setStatus("Please add a name for the RSVP.", true);
      return;
    }

    if (backendMode === "supabase" && !inviteCode) {
      setStatus("Please enter the party code to RSVP.", true);
      return;
    }

    persistInviteCode(inviteCode);
    setStatus("Saving RSVP...");

    const rsvp = {
      invite_code: inviteCode,
      guest_token: getGuestToken(),
      guest_name: guestName,
      attending: attending ? "yes" : "no",
      adults,
      children,
      note: cleanText(formData.get("note"))
    };

    try {
      await saveRsvp(rsvp);
      elements.form.reset();
      elements.form.querySelector('input[name="attending"][value="yes"]').checked = true;
      elements.form.querySelector('input[name="children"]').value = "1";
      elements.form.querySelector('input[name="adults"]').value = "1";
      syncInviteCode(inviteCode, "submit");
      setStatus(attending ? "RSVP saved. See you there!" : "RSVP saved. Thanks for letting us know.");
      await loadAndRender();
    } catch (error) {
      setStatus(formatRsvpError(error), true);
      console.error(error);
    }
  }

  function onGuestCodeSubmit(eventInfo) {
    eventInfo.preventDefault();
    const code = cleanText(elements.guestCode.value);

    if (backendMode === "supabase" && !code) {
      setGuestMessage("Use the link from the school email, or enter the party code to view RSVPs.");
      return;
    }

    persistInviteCode(code);
    loadAndRender();
  }

  async function saveRsvp(rsvp) {
    if (backendMode === "supabase") {
      const { error } = await supabaseClient.rpc("submit_rsvp", {
        p_invite_code: rsvp.invite_code,
        p_guest_token: rsvp.guest_token,
        p_guest_name: rsvp.guest_name,
        p_attending: rsvp.attending,
        p_adults: rsvp.adults,
        p_children: rsvp.children,
        p_note: rsvp.note
      });

      if (error) {
        throw error;
      }
      return;
    }

    const existing = await loadLocalRows();
    const nextRows = existing.filter((row) => row.guest_token !== rsvp.guest_token);
    nextRows.push({
      ...rsvp,
      id: randomToken(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    localStorage.setItem(storageKey, JSON.stringify(nextRows));
  }

  async function loadRows() {
    if (backendMode === "supabase") {
      const inviteCode = getInviteCode();

      if (!inviteCode) {
        return null;
      }

      const { data, error } = await supabaseClient.rpc("list_rsvps", {
        p_invite_code: inviteCode
      });

      if (error) {
        throw error;
      }
      return data || [];
    }

    if (backendMode === "local") {
      return loadLocalRows();
    }

    return [];
  }

  async function loadLocalRows() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch (_error) {
      return [];
    }
  }

  async function loadAndRender() {
    try {
      const rows = await loadRows();

      if (rows === null) {
        renderGuestList([], "Use the link from the school email, or enter the party code to view RSVPs.");
        return;
      }

      renderGuestList(rows);
    } catch (error) {
      renderGuestList([], "RSVP list could not load. Check the party code.");
      console.error(error);
    }
  }

  function renderGuestList(rows, emptyMessage) {
    const comingRows = rows
      .filter((row) => row.attending !== "no")
      .sort((a, b) => String(a.guest_name).localeCompare(String(b.guest_name)));

    const totals = comingRows.reduce(
      (summary, row) => {
        summary.families += 1;
        summary.children += Number(row.children || 0);
        summary.adults += Number(row.adults || 0);
        return summary;
      },
      { families: 0, children: 0, adults: 0 }
    );

    elements.familyCount.textContent = totals.families;
    elements.kidCount.textContent = totals.children;
    elements.adultCount.textContent = totals.adults;
    elements.guestItems.innerHTML = "";
    elements.guestEmpty.hidden = comingRows.length > 0;
    elements.guestEmpty.textContent = emptyMessage || "No RSVPs yet.";

    for (const row of comingRows) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const counts = document.createElement("span");

      name.className = "guest-name";
      counts.className = "guest-count";
      name.textContent = row.guest_name;
      counts.textContent = formatCounts(row.children, row.adults);

      item.append(name, counts);
      elements.guestItems.append(item);
    }
  }

  function setGuestMessage(message) {
    renderGuestList([], message);
  }

  function formatCounts(children, adults) {
    const childCount = Number(children || 0);
    const adultCount = Number(adults || 0);
    const parts = [];

    if (childCount === 1) parts.push("1 kid");
    if (childCount > 1) parts.push(childCount + " kids");
    if (adultCount === 1) parts.push("1 grown-up");
    if (adultCount > 1) parts.push(adultCount + " grown-ups");

    return parts.join(", ") || "Coming";
  }

  function getInviteCode() {
    return cleanText(elements.guestCode.value || elements.inviteCode.value || sessionStorage.getItem(codeStorageKey));
  }

  function syncInviteCode(value, source) {
    const code = cleanText(value);

    if (source !== "form" && elements.inviteCode.value !== code) {
      elements.inviteCode.value = code;
    }
    if (source !== "guest" && elements.guestCode.value !== code) {
      elements.guestCode.value = code;
    }
  }

  function persistInviteCode(value) {
    const code = cleanText(value);
    syncInviteCode(code, "persist");

    if (code) {
      sessionStorage.setItem(codeStorageKey, code);
    }
  }

  function setCodeFieldsVisible(visible) {
    elements.inviteCodeField.hidden = !visible;
    elements.guestCodeForm.hidden = !visible;
  }

  function getGuestToken() {
    let token = localStorage.getItem(tokenStorageKey);

    if (!token) {
      token = randomToken();
      localStorage.setItem(tokenStorageKey, token);
    }

    return token;
  }

  function cleanText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function clampNumber(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
  }

  function randomToken() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    return String(Date.now()) + "-" + Math.random().toString(36).slice(2);
  }

  function setStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", Boolean(isError));
  }

  function formatRsvpError(error) {
    const message = String((error && error.message) || "");

    if (message.toLowerCase().includes("invite code")) {
      return "The party code did not match. Please check it and try again.";
    }

    return "RSVP could not be saved. Please try again or contact the host.";
  }

  function setFormDisabled(disabled) {
    for (const control of elements.form.querySelectorAll("input, textarea, button")) {
      control.disabled = disabled;
    }
    elements.refreshButton.disabled = disabled;
    for (const control of elements.guestCodeForm.querySelectorAll("input, button")) {
      control.disabled = disabled;
    }
  }

  function downloadCalendarInvite() {
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Ava Jinks Birthday//Invite//EN",
      "BEGIN:VTIMEZONE",
      "TZID:America/Denver",
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0600",
      "TZNAME:MDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0700",
      "TZNAME:MST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:ava-jinks-4th-birthday-20260602@example.com",
      "DTSTAMP:20260511T000000Z",
      "DTSTART;TZID=America/Denver:" + event.startLocal,
      "DTEND;TZID=America/Denver:" + event.endLocal,
      "SUMMARY:" + escapeIcs(event.title),
      "LOCATION:" + escapeIcs(event.location),
      "DESCRIPTION:" + escapeIcs(event.details),
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ava-jinks-4th-birthday.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function escapeIcs(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
})();
