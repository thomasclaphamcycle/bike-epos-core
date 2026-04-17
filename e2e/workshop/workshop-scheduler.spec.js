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
test("Workshop scheduler double click opens intake with a prefilled 30 minute slot", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-double-click",
  });
  const token = uniqueToken("workshop-double-click");
  const todayKey = getLondonDateKey();
  const schedulerDateKey = await getFirstOpenWorkshopDateKeyViaBypass(request, "MANAGER", todayKey);
  const seededJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Double Click Existing ${token}`,
      bikeDescription: `Existing bike ${token}`,
      status: "BOOKED",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(seededJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${schedulerDateKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  const todayTrack = page.getByTestId(`workshop-scheduler-day-track-${schedulerDateKey}`);
  await expect(todayTrack).toBeVisible();

  const emptyPoint = await todayTrack.evaluate((track) => {
    const trackRect = track.getBoundingClientRect();
    const timelineOpenMinutes = 8 * 60;
    const timelineCloseMinutes = 19 * 60;
    const schedulerSlotMinutes = 30;
    const slotSafeOffsetMinutes = 8;
    const defaultDurationMinutes = 30;
    const pxPerMinute = trackRect.height / (timelineCloseMinutes - timelineOpenMinutes);
    const blockers = Array.from(
      track.querySelectorAll(".workshop-scheduler-block, .workshop-scheduler-timeoff"),
    )
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left - trackRect.left,
          right: rect.right - trackRect.left,
          top: rect.top - trackRect.top,
          bottom: rect.bottom - trackRect.top,
        };
      })
      .sort((left, right) => left.top - right.top || left.left - right.left);

    const isClear = (xOffset, yOffset) =>
      xOffset > 16
      && xOffset < trackRect.width - 16
      && yOffset > 24
      && yOffset < trackRect.height - 24
      && blockers.every((blocker) =>
        yOffset < blocker.top
        || yOffset > blocker.bottom
        || xOffset < blocker.left
        || xOffset > blocker.right,
      );

    const preferredXOffsets = [
      Math.floor(trackRect.width * 0.5),
      Math.floor(trackRect.width * 0.25),
      Math.floor(trackRect.width * 0.75),
      Math.floor(trackRect.width * 0.125),
      Math.floor(trackRect.width * 0.875),
    ];
    const maxStartMinutes = timelineCloseMinutes - defaultDurationMinutes;
    const preferredSlotStarts = [];

    for (let startMinutes = 12 * 60; startMinutes <= maxStartMinutes; startMinutes += schedulerSlotMinutes) {
      preferredSlotStarts.push(startMinutes);
    }

    for (let startMinutes = timelineOpenMinutes; startMinutes < 12 * 60; startMinutes += schedulerSlotMinutes) {
      preferredSlotStarts.push(startMinutes);
    }

    for (const startMinutes of preferredSlotStarts) {
      const yOffset = Math.floor((startMinutes + slotSafeOffsetMinutes - timelineOpenMinutes) * pxPerMinute);
      if (yOffset <= 24 || yOffset >= trackRect.height - 24) {
        continue;
      }

      for (const xOffset of preferredXOffsets) {
        if (isClear(xOffset, yOffset)) {
          const expectedTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
          return { x: xOffset, y: yOffset, expectedTime };
        }
      }
    }

    throw new Error("Expected to find a clear scheduler slot away from slot boundaries.");
  });

  const trackBox = await todayTrack.boundingBox();
  if (!trackBox) {
    throw new Error("Expected today track to have a bounding box.");
  }

  await todayTrack.dblclick({
    position: {
      x: emptyPoint.x,
      y: emptyPoint.y,
    },
  });

  const intakeDialog = page.getByTestId("workshop-intake");
  await expect(intakeDialog).toBeVisible();
  await expect(intakeDialog.getByTestId("workshop-checkin-planned-slot-summary")).toContainText("30 min");

  await intakeDialog.getByText("Create new customer", { exact: true }).click();
  await intakeDialog.getByLabel("New customer name").fill(`Double Click Intake ${token}`);
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByTestId("workshop-checkin-add-bike").click();
  const bikeDialog = page.getByTestId("workshop-checkin-bike-create");
  await bikeDialog.getByLabel("Brand").fill("Trek");
  await bikeDialog.getByLabel("Model").fill(`Scheduler Bike ${token}`);
  await bikeDialog.getByLabel("Colour").fill("Blue");
  await bikeDialog.getByLabel("Size").fill("56cm");
  await bikeDialog.getByTestId("workshop-checkin-bike-save").click();
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByPlaceholder("Describe the problem or requested work").fill("Scheduler double click check");
  await intakeDialog.getByText("Next", { exact: true }).click();

  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-date")).toHaveValue(schedulerDateKey);
  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-time")).toHaveValue(emptyPoint.expectedTime);
  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-duration")).toHaveValue("30");

  await intakeDialog.getByLabel("Close new job modal").click();
  await expect(page.getByTestId("workshop-intake")).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${seededJob.id}`).dblclick();
  await expect(page.locator(".workshop-checkin-modal")).toHaveCount(0);
});

test("Workshop scheduler shows a live work indicator only for jobs active right now", async ({ page, request }) => {
  const frozenNowIso = "2026-01-15T10:15:00.000Z";
  const todayKey = getLondonDateKey(new Date(frozenNowIso));
  await freezeBrowserClock(page, frozenNowIso);

  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-live-work",
  });
  const token = uniqueToken("workshop-live-work");

  const activeJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Active ${token}`,
      bikeDescription: `Active bike ${token}`,
      status: "BOOKED",
    },
  });
  const futureJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Future ${token}`,
      bikeDescription: `Future bike ${token}`,
      status: "BOOKED",
    },
  });
  const readyJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Ready ${token}`,
      bikeDescription: `Ready bike ${token}`,
      status: "BOOKED",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(activeJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(futureJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T12:00:00`,
        durationMinutes: 30,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(readyJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(readyJob.id)}/status`,
    "MANAGER",
    {
      data: {
        status: "READY_FOR_COLLECTION",
      },
    },
  );

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  await expect(page.getByTestId(`workshop-scheduler-job-${activeJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-${futureJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-${readyJob.id}`)).toBeVisible();

  await expect(page.getByTestId(`workshop-scheduler-job-live-${activeJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-live-${futureJob.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`workshop-scheduler-job-live-${readyJob.id}`)).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${activeJob.id}`).click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveText("Now: Being worked on");
  await page.getByLabel("Close job card").click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${readyJob.id}`).click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveCount(0);
});

test("Rota planner supports row drag-copy and Fill Mon-Fri without spilling into another staff row", async ({
  page,
  request,
}) => {
  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "rota-manager",
  });
  const token = uniqueToken("rota-drag");
  const alpha = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "rota-alpha",
    name: `Rota Alpha ${token}`,
  });
  const beta = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "rota-beta",
    name: `Rota Beta ${token}`,
  });

  const rotaPeriod = await createRotaPeriodViaBypass(request, "2099-04-06", `Rota drag ${token}`);
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: alpha.user.id,
    date: "2099-04-11",
    shiftType: "HALF_DAY_PM",
  });
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: beta.user.id,
    date: "2099-04-07",
    shiftType: "FULL_DAY",
  });
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: beta.user.id,
    date: "2099-04-08",
    shiftType: "FULL_DAY",
  });

  await loginViaUi(
    page,
    managerCredentials,
    `/management/staff-rota?periodId=${encodeURIComponent(rotaPeriod.rotaPeriod.id)}&staffScope=all&search=${encodeURIComponent(token)}`,
    { surface: "frontend" },
  );

  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 1");
  await page.getByTestId("rota-week-next").click();
  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 2");
  await page.getByTestId("rota-week-prev").click();
  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 1");

  const alphaMonday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-06`);
  const alphaTuesday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-07`);
  const alphaWednesday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-08`);
  const alphaThursday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-09`);
  const alphaFriday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-10`);
  const alphaSaturday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-11`);
  const betaMonday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-06`);
  const betaTuesday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-07`);
  const betaWednesday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-08`);

  await alphaMonday.click();
  await page.getByRole("menuitem", { name: "AM", exact: true }).click();
  await expect(alphaMonday).toContainText("AM");

  await alphaThursday.dblclick();
  await expect(alphaThursday).toContainText("Full");
  await alphaThursday.dblclick();
  await expect(alphaThursday).toContainText("Off");

  await dragBetweenLocators(page, alphaMonday, alphaWednesday);
  await expect(alphaTuesday).toContainText("AM");
  await expect(alphaWednesday).toContainText("AM");
  await expect(betaTuesday).toContainText("Full");
  await expect(betaWednesday).toContainText("Full");

  await dragBetweenLocators(page, betaMonday, betaWednesday);
  await expect(betaTuesday).toContainText("Off");
  await expect(betaWednesday).toContainText("Off");
  await expect(alphaTuesday).toContainText("AM");

  await page.getByTestId(`rota-fill-weekdays-${alpha.user.id}`).click();
  await expect(alphaMonday).toContainText("Full");
  await expect(alphaTuesday).toContainText("Full");
  await expect(alphaWednesday).toContainText("Full");
  await expect(alphaThursday).toContainText("Full");
  await expect(alphaFriday).toContainText("Full");
  await expect(alphaSaturday).toContainText("PM");
});
