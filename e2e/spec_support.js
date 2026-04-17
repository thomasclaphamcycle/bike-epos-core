const { expect } = require("@playwright/test");
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
} = require("./helpers");

const frontendBaseUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";
const toLocalFrontendUrl = (publicUrl) => {
  const parsed = new URL(publicUrl);
  return new URL(`${parsed.pathname}${parsed.search}`, frontendBaseUrl).toString();
};

const expandPosCustomerCaptureFallback = async (page) => {
  const captureUrl = page.getByTestId("pos-customer-capture-url");
  if (await captureUrl.count()) {
    return captureUrl;
  }

  await page.getByTestId("pos-customer-capture-fallback").getByText("Fallback").click();
  await expect(captureUrl).toBeVisible();
  return captureUrl;
};

const collectPosAddTwoDiagnostics = async (page, variantId) => page.evaluate((buttonTestId) => {
  const serializeElement = (selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return {
      selector,
      tagName: element.tagName,
      className: element.className,
      text: element.textContent?.trim().slice(0, 200) ?? "",
      rect: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      computedStyle: {
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        display: style.display,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      },
    };
  };

  const addButtonSelector = `[data-testid="${buttonTestId}"]`;
  const addButton = document.querySelector(addButtonSelector);
  let elementAtButtonCenter = null;

  if (addButton) {
    const rect = addButton.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const topElement = document.elementFromPoint(centerX, centerY);
    const topStyle = topElement ? window.getComputedStyle(topElement) : null;

    elementAtButtonCenter = topElement ? {
      tagName: topElement.tagName,
      className: topElement.className,
      testId: topElement.getAttribute("data-testid"),
      text: topElement.textContent?.trim().slice(0, 200) ?? "",
      computedStyle: topStyle ? {
        position: topStyle.position,
        zIndex: topStyle.zIndex,
        pointerEvents: topStyle.pointerEvents,
      } : null,
    } : null;
  }

  return {
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    elements: {
      posLayout: serializeElement(".pos-layout"),
      posMainColumn: serializeElement(".pos-main-column"),
      posSideColumn: serializeElement(".pos-side-column"),
      posSearchPanel: serializeElement(".pos-search-panel"),
      posResultsWrap: serializeElement(".pos-results-wrap"),
      posSearchField: serializeElement(".pos-search-field"),
      addTwoButton: serializeElement(addButtonSelector),
    },
    elementAtButtonCenter,
  };
}, `pos-product-add-${variantId}`);

const parseOnHand = (labelText) => {
  const match = labelText.match(/On hand:\s*(-?\d+)/i);
  if (!match) {
    throw new Error(`Could not parse on-hand from "${labelText}"`);
  }
  return Number.parseInt(match[1], 10);
};

const expectStocktakeLineCount = async (page, variantId, expectedCount) => {
  await expect.poll(async () => {
    const cell = page.getByTestId(`stocktake-line-count-${variantId}`);
    if (await cell.count() === 0) {
      return null;
    }
    return (await cell.first().textContent())?.trim() ?? null;
  }, {
    message: `Expected stocktake line ${variantId} count to become ${expectedCount}`,
  }).toBe(String(expectedCount));
};

const freezeBrowserClock = async (page, isoValue) => {
  await page.addInitScript(({ isoValue: fixedIso }) => {
    const fixedTime = new Date(fixedIso).getTime();
    const RealDate = Date;

    class FrozenDate extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedTime] : args));
      }

      static now() {
        return fixedTime;
      }
    }

    Object.defineProperty(FrozenDate, "parse", {
      value: RealDate.parse,
    });
    Object.defineProperty(FrozenDate, "UTC", {
      value: RealDate.UTC,
    });

    window.Date = FrozenDate;
    globalThis.Date = FrozenDate;
  }, { isoValue });
};

const ensureOpenRegisterSession = async (request) => {
  const current = await apiJsonWithHeaderBypass(
    request,
    "GET",
    "/api/management/cash/register/current",
    "MANAGER",
  );
  if (current?.session?.id) {
    return current;
  }

  return apiJsonWithHeaderBypass(
    request,
    "POST",
    "/api/management/cash/register/open",
    "MANAGER",
    {
      data: { openingFloatPence: 0 },
    },
  );
};

const createRotaPeriodViaBypass = async (request, startsOn, label) => {
  return apiJsonWithHeaderBypass(request, "POST", "/api/rota/periods", "MANAGER", {
    data: {
      startsOn,
      label,
    },
  });
};

const saveRotaAssignmentViaBypass = async (request, input) => {
  return apiJsonWithHeaderBypass(request, "POST", "/api/rota/assignments", "MANAGER", {
    data: input,
  });
};

const dragBetweenLocators = async (page, source, target) => {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error("Expected both drag endpoints to be visible.");
  }

  await page.mouse.move(sourceBox.x + (sourceBox.width / 2), sourceBox.y + (sourceBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(targetBox.x + (targetBox.width / 2), targetBox.y + (targetBox.height / 2), {
    steps: 12,
  });
  await page.mouse.up();
};

const seedNamedQuickAddProduct = async (request, options) => {
  const token = uniqueToken(`quick-add-${options.slug}`);
  const safeToken = token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const product = await apiJsonWithHeaderBypass(request, "POST", "/api/products", "MANAGER", {
    data: {
      name: options.name,
      brand: "Quick Add",
      description: `${options.name} quick add seed`,
    },
  });

  const variant = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/products/${encodeURIComponent(product.id)}/variants`,
    "MANAGER",
    {
      data: {
        sku: `QA-${options.slug}-${safeToken}`,
        barcode: `QA-BC-${options.slug}-${safeToken}`,
        name: options.name,
        retailPricePence: options.retailPricePence,
      },
    },
  );

  await apiJsonWithHeaderBypass(request, "POST", "/api/inventory/adjustments", "MANAGER", {
    data: {
      variantId: variant.id,
      quantityDelta: options.initialOnHand ?? 6,
      reason: "COUNT_CORRECTION",
      note: `Quick add seed ${token}`,
    },
  });

  return { product, variant };
};

module.exports = {
  ...require("./helpers"),
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
};
