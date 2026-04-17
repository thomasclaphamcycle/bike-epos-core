const { test, expect } = require("@playwright/test");
const {
  addDaysToDateKey,
  apiJson,
  apiJsonWithHeaderBypass,
  ensureUserViaAdminBypass,
  getFirstOpenWorkshopDateKeyViaBypass,
  getLondonDateKey,
  getMondayDateKey,
  getOperationalWeekStartDateKey,
  loginViaUi,
  markWebOrderPackedViaBypass,
  parseDateKeyAtNoon,
  searchInventoryRows,
  searchOnlineStoreOrders,
  seedCatalogVariant,
  seedPosSaleViaBypass,
  uniqueToken,
  frontendBaseUrl,
  toLocalFrontendUrl,
  expandPosCustomerCaptureFallback,
  collectPosAddTwoDiagnostics,
  parseOnHand,
  expectStocktakeLineCount,
  freezeBrowserClock,
  ensureOpenRegisterSession,
  createRotaPeriodViaBypass,
  saveRotaAssignmentViaBypass,
  dragBetweenLocators,
  seedNamedQuickAddProduct,
} = require("../spec_support");

test.describe.configure({ mode: "default" });
test("Workshop job page flags quote drift after approval and keeps the next action explicit", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-quote-drift",
  });
  const token = uniqueToken("workshop-quote-drift");
  const job = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Quote Drift ${token}`,
      bikeDescription: `Bike ${token}`,
      notes: `Quote drift check ${token}`,
      status: "BOOKED",
    },
  });

  const labourLine = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Workshop labour",
        qty: 1,
        unitPricePence: 4500,
      },
    },
  );

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/estimate`,
    "MANAGER",
    { data: {} },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/approval`,
    "MANAGER",
    {
      data: {
        status: "APPROVED",
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines/${encodeURIComponent(labourLine.line.id)}`,
    "MANAGER",
    {
      data: {
        description: "Workshop labour plus extra fitting",
        qty: 1,
        unitPricePence: 5200,
      },
    },
  );

  await page.context().clearCookies();
  await loginViaUi(page, credentials, `/workshop/${job.id}`, { surface: "frontend" });

  await expect(page.getByTestId("workshop-job-estimate-state")).toContainText("Changed after approval");
  await expect(page.getByTestId("workshop-job-estimate-state")).toContainText("£52.00");
  await expect(page.getByTestId("workshop-job-next-action")).toContainText("Re-issue the quote");
  await expect(page.getByTestId("workshop-job-next-action")).toContainText("Save revised quote");
});

test("Login then workshop page can create a job", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-create",
  });
  const token = uniqueToken("workshop-create");
  const customerName = `E2E Customer ${token}`;

  await loginViaUi(page, credentials, "/workshop");
  await page.fill("#create-customer", customerName);
  await page.fill("#create-bike", `E2E Bike ${token}`);
  await page.fill("#create-notes", `E2E notes ${token}`);
  await page.click("#create-job");

  await expect(page.locator("#job-create-status")).toContainText("Job created");
  await expect(page.locator("#selected-job-meta")).toContainText(customerName);
  await expect(page.locator("#jobs-wrap")).toContainText(customerName);
});

test("Workshop page highlights today and keeps the live schedule range today-aware", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-today",
  });
  const todayKey = getLondonDateKey();
  const visibleStart = getOperationalWeekStartDateKey(todayKey);
  const visibleEnd = addDaysToDateKey(visibleStart, 6);
  const nextVisibleStart = getOperationalWeekStartDateKey(addDaysToDateKey(todayKey, 7));

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  await expect(page.getByTestId("workshop-operating-page")).toBeVisible();
  await expect(page.getByTestId("workshop-operating-overview")).toBeVisible();
  await expect(page.getByTestId("workshop-board-overview")).toHaveCount(0);
  await expect(page.getByTestId("workshop-scheduler-unscheduled-panel")).toBeVisible();
  await expect(page.getByTestId("workshop-scheduler-unassigned-panel")).toBeVisible();
  const headers = page.locator('[data-testid^="workshop-scheduler-day-header-"]');
  await expect(headers).toHaveCount(7);
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveAttribute("data-current-day", "true");

  const headerIds = await headers.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid")),
  );

  expect(headerIds[0]).toBe(`workshop-scheduler-day-header-${visibleStart}`);
  expect(headerIds[headerIds.length - 1]).toBe(`workshop-scheduler-day-header-${visibleEnd}`);
  const todayIndex = headerIds.indexOf(`workshop-scheduler-day-header-${todayKey}`);
  expect(todayIndex).toBeGreaterThanOrEqual(0);
  expect((headerIds.length - 1) - todayIndex).toBeGreaterThan(todayIndex);

  await page.getByRole("button", { name: "Next Week" }).click();
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveCount(0);
  await expect(page.getByTestId(`workshop-scheduler-day-header-${nextVisibleStart}`)).toBeVisible();

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveAttribute("data-current-day", "true");
});

test("Workshop queue keeps action triage separate from timed scheduling", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-queue",
  });

  await loginViaUi(page, credentials, "/workshop/queue", { surface: "frontend" });

  await expect(page.getByTestId("workshop-queue-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.getByText("Front of house now")).toBeVisible();
  await expect(page.getByText("Bench now")).toBeVisible();
  await expect(page.getByText("Planning gaps")).toBeVisible();
  await expect(page.getByText("Fast intake")).toBeVisible();
  await expect(page.locator('[data-testid^="workshop-scheduler-day-header-"]')).toHaveCount(0);
});

test("Workshop technician view keeps assigned, blocked, and handoff work execution-first", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "workshop-technician",
  });
  const token = uniqueToken("workshop-technician");
  const assignmentDateKey = await getFirstOpenWorkshopDateKeyViaBypass(request);
  const rotaOverview = await apiJsonWithHeaderBypass(request, "GET", "/api/rota", "MANAGER");
  const currentRotaPeriod = rotaOverview.periods?.find((period) => period.isCurrent) ?? null;
  const createdRotaPeriod = currentRotaPeriod
    ? null
    : await createRotaPeriodViaBypass(
      request,
      getMondayDateKey(assignmentDateKey),
      `Technician workflow ${token}`,
    );
  const rotaPeriodId = currentRotaPeriod?.id ?? createdRotaPeriod?.rotaPeriod?.id ?? null;

  if (typeof rotaPeriodId !== "string" || !rotaPeriodId.trim()) {
    throw new Error("Expected technician workflow setup to resolve a valid rotaPeriodId.");
  }

  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId,
    staffId: credentials.user.id,
    date: assignmentDateKey,
    shiftType: "FULL_DAY",
  });

  const createAssignedJob = async ({ customerName, bikeDescription, status, startTime, internalNote }) => {
    const job = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
      data: {
        customerName,
        bikeDescription,
        status: "BOOKED",
      },
    });

    await apiJsonWithHeaderBypass(
      request,
      "POST",
      `/api/workshop/jobs/${encodeURIComponent(job.id)}/assign`,
      "MANAGER",
      {
        data: {
          staffId: credentials.user.id,
        },
      },
    );

    await apiJsonWithHeaderBypass(
      request,
      "PATCH",
      `/api/workshop/jobs/${encodeURIComponent(job.id)}/schedule`,
      "MANAGER",
      {
        data: {
          scheduledStartAt: `${assignmentDateKey}T${startTime}:00`,
          durationMinutes: 60,
        },
      },
    );

    if (status !== "BOOKED") {
      await apiJsonWithHeaderBypass(
        request,
        "POST",
        `/api/workshop/jobs/${encodeURIComponent(job.id)}/status`,
        "MANAGER",
        {
          data: {
            status,
          },
        },
      );
    }

    if (internalNote) {
      await apiJsonWithHeaderBypass(
        request,
        "POST",
        `/api/workshop/jobs/${encodeURIComponent(job.id)}/notes`,
        "STAFF",
        {
          headers: {
            "X-Staff-Id": credentials.user.id,
          },
          data: {
            visibility: "INTERNAL",
            note: internalNote,
          },
        },
      );
    }

    return job;
  };

  const actionableJob = await createAssignedJob({
    customerName: `Bench Customer ${token}`,
    bikeDescription: `Bench Bike ${token}`,
    status: "BIKE_ARRIVED",
    startTime: "10:00",
    internalNote: "Bike washed and ready for bench start",
  });
  const blockedJob = await createAssignedJob({
    customerName: `Blocked Customer ${token}`,
    bikeDescription: `Blocked Bike ${token}`,
    status: "WAITING_FOR_PARTS",
    startTime: "12:00",
  });
  await createAssignedJob({
    customerName: `Ready Customer ${token}`,
    bikeDescription: `Ready Bike ${token}`,
    status: "READY_FOR_COLLECTION",
    startTime: "14:00",
  });

  await loginViaUi(page, credentials, "/workshop/technician", { surface: "frontend" });

  await expect(page.getByTestId("workshop-technician-page")).toBeVisible();
  await expect(page.getByTestId("workshop-technician-summary")).toContainText("Actionable now");
  await expect(page.getByTestId("workshop-technician-section-actionable")).toContainText(`Bench Bike ${token}`);
  await expect(page.getByTestId("workshop-technician-section-blocked")).toContainText(`Blocked Bike ${token}`);
  await expect(page.getByTestId("workshop-technician-section-handoff")).toContainText(`Ready Bike ${token}`);

  await page
    .getByTestId(`workshop-technician-card-${actionableJob.id}`)
    .getByRole("button", { name: new RegExp(`Bench Bike ${token}`) })
    .click();

  await expect(page.getByTestId("workshop-technician-detail")).toContainText("Bike washed and ready for bench start");
  await page.getByTestId(`workshop-technician-action-${actionableJob.id}-start-work-detail`).click();
  await expect(page.getByTestId("workshop-technician-detail")).toContainText("In Repair");

  const noteForm = page.getByTestId("workshop-technician-note-form");
  await noteForm.getByRole("textbox").fill("Rear brake bled and final road test still to do");
  await noteForm.getByRole("button", { name: "Save internal note" }).click();
  await expect(page.getByTestId("workshop-technician-detail")).toContainText("Rear brake bled and final road test still to do");
});

test("Workshop job page surfaces commercial prompts from linked bike history", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-commercial",
  });
  const token = uniqueToken("workshop-commercial");
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `Commercial Customer ${token}`,
      email: `${token}@example.com`,
      phone: `07111${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  const bike = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/customers/${encodeURIComponent(customer.id)}/bikes`,
    "MANAGER",
    {
      data: {
        label: "Daily e-bike",
        make: "Specialized",
        model: `Turbo Vado ${token.slice(-4)}`,
        bikeType: "E_BIKE",
        motorBrand: "Bosch",
        motorModel: "Performance Line",
        colour: "Green",
      },
    },
  );

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/customers/bikes/${encodeURIComponent(bike.bike.id)}/service-schedules`,
    "MANAGER",
    {
      data: {
        type: "BRAKES",
        title: "Brake service",
        description: "Check brake pads, braking surface, and setup.",
        intervalMonths: 6,
        lastServiceAt: "2025-08-01T10:00:00.000Z",
        nextDueAt: "2026-02-01T10:00:00.000Z",
        isActive: true,
      },
    },
  );

  await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/service-templates", "MANAGER", {
    data: {
      name: "Brake service package",
      category: "Brakes",
      description: "Pads, cables, caliper setup, and brake health check.",
      defaultDurationMinutes: 60,
      lines: [
        {
          type: "LABOUR",
          description: "Brake service labour",
          qty: 1,
          unitPricePence: 6500,
          sortOrder: 0,
        },
      ],
    },
  });

  const workshopJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerId: customer.id,
      bikeId: bike.bike.id,
      status: "BOOKED",
      notes: "Customer reports general handling concerns.",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Wheel true and general workshop assessment",
        qty: 1,
        unitPricePence: 5200,
      },
    },
  );

  await loginViaUi(page, credentials, `/workshop/${workshopJob.id}`, { surface: "frontend" });
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Offer brake service while the bike is in");
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Brake service package");
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Bosch");
});

test("Login then workshop add labour and checkout marks job as collected", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-checkout",
  });
  const token = uniqueToken("workshop-checkout");
  const customerName = `E2E Checkout ${token}`;

  await loginViaUi(page, credentials, "/workshop");
  await page.fill("#create-customer", customerName);
  await page.fill("#create-bike", `E2E Bike ${token}`);
  await page.fill("#create-notes", `Checkout notes ${token}`);

  const createResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes("/api/workshop/jobs") &&
      response.request().method() === "POST" &&
      response.status() === 201
    );
  });

  await page.click("#create-job");
  const createResponse = await createResponsePromise;
  const createdJob = await createResponse.json();
  const jobId = createdJob.id;
  if (!jobId) {
    throw new Error("Workshop job create response did not include id");
  }

  await page.fill("#labour-desc", "Safety check labour");
  await page.fill("#labour-qty", "1");
  await page.fill("#labour-price", "5000");
  await page.click("#add-labour-btn");
  await expect(page.locator("#labour-status")).toContainText("Labour line added.");
  await ensureOpenRegisterSession(request);

  const checkout = await apiJson(page.request, "POST", `/api/workshop/jobs/${jobId}/checkout`, {
    data: {
      saleTotalPence: 5000,
      paymentMethod: "CASH",
      amountPence: 5000,
      providerRef: `pw-${token}`,
    },
  });

  expect(checkout.sale.id).toBeTruthy();

  const refreshed = await apiJson(page.request, "GET", `/api/workshop/jobs/${jobId}`);
  expect(refreshed.job.status).toBe("COLLECTED");

  await page.click("#refresh-jobs");
  await expect(page.locator("#jobs-wrap")).toContainText("COLLECTED");
});
