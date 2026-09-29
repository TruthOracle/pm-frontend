/**
 * The market factory: one form, submitted to the backend's treasury-signed `POST /admin/markets`
 * (truthoracle-backend docs/MARKETS.md §4). Identity comes from the catalog — a market is a leg
 * of an event and its ticker is `EVENT-SUFFIX` — and the backend refuses an unknown event or a
 * taken ticker before anything reaches the ledger, then submits `MarketCounter.CreateMarket`
 * through the Enterprise Wallet. Everything below the identity block is the pm-AMM seed and the
 * resolution policy, both immutable once the contract exists. The market shows up in the catalog
 * as soon as the indexer sees it.
 */
import { useState } from "react";
import { Box, Button, Flex, FormLabel, Input, Select, Switch, Text, Textarea, useToast } from "@chakra-ui/react";
import { createMarketViaBackend } from "@/lib/backendAdmin";
import { TICKER_PATTERN, type ApiEvent, type ApiSeries } from "@/lib/marketsTypes";
import { liquidityFromValue, optimalReserves } from "@/lib/marketPricing";
import { parseUTCInput } from "@/lib/time";

/** Runs one operator action with the console's busy state, reload and toasts (see CatalogPanel). */
export type Run = (what: string, fn: () => Promise<unknown>, done: string) => Promise<boolean>;

const TICKER_HINT = "Upper-case letters, digits and . _ - only, 2–64 characters (e.g. FED-26MAR-CUT25).";
const BUSY_KEY = "Create market";

const initialForm = {
  eventTicker: "",
  suffix: "",
  question: "",
  yesSubTitle: "Yes",
  noSubTitle: "No",
  imageUrl: "",
  description: "",
  resolutionDescription: "",
  expiresAtUtc: "", // datetime-local value, read as UTC
  gracePeriodHours: 24,
  isDynamic: true,
  liquidityPeriodMinutes: 5, // pre-trading liquidity-collection window (default 5 min)
  initialProbability: 50, // percent
  initialValueCC: 100, // pool value V0 in CC
  feeBps: 30,
  prizeFeeShareBps: 2000,
  // Resolution policy
  operatorResolution: true,
  sources: "", // comma-separated URIs
  reporters: "", // comma-separated party ids
  quorum: 0,
  challengeHours: 0, // 0 disables T3
  bondCC: 0,
  // Audit log
  reason: "",
};

type FormState = typeof initialForm;

const splitList = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export default function CreateMarketForm({ events, series, busy, run }: { events: ApiEvent[]; series: ApiSeries[]; busy: string | null; run: Run }) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  // The event image the image field was last prefilled with, so switching events replaces a
  // default but never an operator's own URL.
  const [imageFromEvent, setImageFromEvent] = useState("");

  const open = events.filter((e) => !e.archived);
  const event = open.find((e) => e.ticker === form.eventTicker);
  const category = event ? (series.find((s) => s.ticker === event.seriesTicker)?.category ?? event.category ?? "") : "";
  const suffix = form.suffix.trim().toUpperCase();
  const ticker = form.eventTicker && suffix ? `${form.eventTicker}-${suffix}` : "";
  const tickerError = ticker !== "" && !TICKER_PATTERN.test(ticker) ? TICKER_HINT : null;

  const p0 = Math.min(0.99, Math.max(0.01, form.initialProbability / 100));
  const seedCost = (() => {
    try {
      const l0 = liquidityFromValue(form.initialValueCC, p0);
      const { x, y } = optimalReserves(p0, l0);
      return Math.max(x, y);
    } catch {
      return 0;
    }
  })();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "number" ? Number(value) : value }));
  };

  const chooseEvent = (eventTicker: string) => {
    const next = open.find((e) => e.ticker === eventTicker);
    const nextImage = next?.imageUrl ?? "";
    setForm((prev) => ({
      ...prev,
      eventTicker,
      imageUrl: prev.imageUrl === "" || prev.imageUrl === imageFromEvent ? nextImage : prev.imageUrl,
    }));
    setImageFromEvent(nextImage);
  };

  const formValid =
    form.eventTicker !== "" &&
    TICKER_PATTERN.test(ticker) &&
    form.question.trim() !== "" &&
    form.description.trim() !== "" &&
    form.resolutionDescription.trim() !== "" &&
    form.expiresAtUtc !== "" &&
    form.initialValueCC > 0 &&
    form.initialProbability >= 1 &&
    form.initialProbability <= 99;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const warn = (title: string, description?: string) => toast({ title, description, status: "warning", duration: 6000, isClosable: true });

    if (!event || !TICKER_PATTERN.test(ticker)) {
      warn("Event and ticker suffix are required", `${TICKER_HINT} The ticker and the event ticker are written on the ledger contract.`);
      return;
    }
    // The field is UTC: every instant on the platform is (see lib/time.ts).
    const expiresMs = parseUTCInput(form.expiresAtUtc);
    if (expiresMs === null || expiresMs <= Date.now()) {
      warn("Expiry must be in the future");
      return;
    }
    const reporters = splitList(form.reporters);
    if (form.quorum > reporters.length) {
      warn("Quorum exceeds reporter count", `Quorum ${form.quorum} but only ${reporters.length} reporters listed.`);
      return;
    }

    const ok = await run(
      BUSY_KEY,
      () =>
        createMarketViaBackend({
          eventTicker: event.ticker,
          ticker,
          question: form.question.trim(),
          // Blank labels fall back to plain Yes / No on the backend; all four identity fields are
          // mandatory Text on the contract.
          yesSubTitle: form.yesSubTitle.trim() || undefined,
          noSubTitle: form.noSubTitle.trim() || undefined,
          // Presentation goes to the backend as market metadata; the contract carries none (v16).
          imageUrl: form.imageUrl.trim() || undefined,
          description: form.description.trim(),
          resolutionDescription: form.resolutionDescription.trim(),
          expiresAt: new Date(expiresMs).toISOString(),
          gracePeriodSecs: Math.max(0, Math.round(form.gracePeriodHours * 3600)),
          isDynamic: form.isDynamic,
          liquidityPeriodSecs: form.isDynamic ? Math.max(0, Math.round(form.liquidityPeriodMinutes * 60)) : 0,
          initialProbability: p0.toFixed(4),
          initialValueCC: String(form.initialValueCC),
          feeBps: form.feeBps,
          prizeFeeShareBps: form.prizeFeeShareBps,
          policy: {
            operatorResolution: form.operatorResolution,
            sources: splitList(form.sources),
            // T1 keys are pinned via operator tooling when the source can sign.
            reporters,
            quorum: form.quorum,
            challengeSecs: Math.max(0, Math.round(form.challengeHours * 3600)),
            bondCC: String(form.bondCC),
          },
          reason: form.reason.trim() || undefined,
        }),
      `CreateMarket submitted for ${ticker}: pm-AMM seeded at ${form.initialProbability}% with ${form.initialValueCC} CC pool value (collateral cost ≈ ${seedCost.toFixed(2)} CC). It appears once the indexer sees it.`,
    );
    if (ok) {
      (window as { refreshMarketplace?: () => void }).refreshMarketplace?.();
      setForm((prev) => ({ ...prev, suffix: "", question: "", yesSubTitle: "Yes", noSubTitle: "No", description: "", resolutionDescription: "", reason: "" }));
    }
  };

  return (
    <form className="font-jbm" onSubmit={(e) => void handleSubmit(e)} style={{ width: "100%" }}>
      <Text fontWeight="bold" fontSize="sm" mb={2}>
        Identity (on-ledger, written once)
      </Text>

      <Flex gap={4} marginBottom="16px" direction={{ base: "column", md: "row" }}>
        <Box flex={2}>
          <label htmlFor="eventTicker">Event (from the catalog)</label>
          <Select id="eventTicker" name="eventTicker" marginTop="2px" placeholder="Select an event…" value={form.eventTicker} onChange={(e) => chooseEvent(e.target.value)}>
            {open.map((ev) => (
              <option key={ev.ticker} value={ev.ticker}>
                {ev.ticker} — {ev.title}
              </option>
            ))}
          </Select>
          {open.length === 0 && (
            <Text color="orange.400" fontSize="xs" mt={1}>
              No open events yet — create a series and an event above first.
            </Text>
          )}
        </Box>
        <Box flex={1}>
          <label htmlFor="suffix">Ticker suffix</label>
          <Input required type="text" marginTop="2px" id="suffix" name="suffix" placeholder="CUT25" value={form.suffix} onChange={(e) => setForm((prev) => ({ ...prev, suffix: e.target.value.toUpperCase() }))} isInvalid={tickerError !== null} />
          <Text color={tickerError ? "red.400" : "gray.500"} fontSize="xs" mt={1}>
            {tickerError ?? (ticker ? `On-ledger ticker: ${ticker}` : "On-ledger ticker: <event ticker>-<suffix>")}
          </Text>
        </Box>
      </Flex>

      <label htmlFor="question">Question</label>
      <Input required type="text" marginBottom="16px" marginTop="2px" id="question" name="question" placeholder="e.g. Will Liverpool beat Brighton on 13 May?" value={form.question} onChange={handleInputChange} />

      <Flex gap={4} marginBottom="16px" direction={{ base: "column", md: "row" }}>
        <Box flex={1}>
          <label htmlFor="yesSubTitle">Yes label (blank = “Yes”)</label>
          <Input type="text" marginTop="2px" id="yesSubTitle" name="yesSubTitle" placeholder="Cut ≥ 25 bps" value={form.yesSubTitle} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="noSubTitle">No label (blank = “No”)</label>
          <Input type="text" marginTop="2px" id="noSubTitle" name="noSubTitle" placeholder="Smaller or none" value={form.noSubTitle} onChange={handleInputChange} />
        </Box>
      </Flex>

      <Text fontWeight="bold" fontSize="sm" mb={2}>
        Presentation
      </Text>

      <label htmlFor="imageUrl">Image URL (optional)</label>
      <Input type="text" marginTop="2px" id="imageUrl" name="imageUrl" placeholder="Add Image URL" value={form.imageUrl} onChange={handleInputChange} />
      <Text color="gray.500" fontSize="xs" mt={1} mb={4}>
        Defaults to the event's image; the market card shows the market's own image when set. Stored by the backend, editable later; not part of the contract.
      </Text>

      <label htmlFor="description">Description</label>
      <Input required type="text" marginTop="2px" id="description" name="description" placeholder="Short description shown on the market card" value={form.description} onChange={handleInputChange} />
      <Text color="gray.500" fontSize="xs" mt={1} mb={4}>
        Stored by the backend, editable later; not part of the contract.
      </Text>

      <label htmlFor="resolutionDescription">Resolution criteria</label>
      <Textarea
        required
        marginBottom="16px"
        marginTop="2px"
        id="resolutionDescription"
        name="resolutionDescription"
        placeholder="How will this market resolve? Cite the authoritative source."
        value={form.resolutionDescription}
        onChange={handleInputChange}
      />

      <Flex gap={4} marginBottom="16px" direction={{ base: "column", md: "row" }}>
        <Box flex={1}>
          <label htmlFor="category">Category (from the series)</label>
          <Input isReadOnly type="text" marginTop="2px" id="category" name="category" placeholder="pick an event first" value={category} />
        </Box>
        <Box flex={1}>
          <label htmlFor="expiresAtUtc">Expiry, UTC (trading stops)</label>
          <Input required type="datetime-local" id="expiresAtUtc" name="expiresAtUtc" marginTop="2px" value={form.expiresAtUtc} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="gracePeriodHours">Resolution grace period (hours)</label>
          <Input required type="number" min={0} step="any" id="gracePeriodHours" name="gracePeriodHours" marginTop="2px" value={form.gracePeriodHours} onChange={handleInputChange} />
        </Box>
      </Flex>

      <Text fontWeight="bold" fontSize="sm" mb={2}>
        pm-AMM seed and fees
      </Text>

      <Flex gap={4} marginBottom="16px" direction={{ base: "column", md: "row" }}>
        <Box flex={1}>
          <label htmlFor="initialProbability">Initial probability (%)</label>
          <Input required type="number" min={1} max={99} id="initialProbability" name="initialProbability" marginTop="2px" value={form.initialProbability} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="initialValueCC">Initial pool value (CC)</label>
          <Input required type="number" min={1} step="any" id="initialValueCC" name="initialValueCC" marginTop="2px" value={form.initialValueCC} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="feeBps">Fee (bps)</label>
          <Input required type="number" min={0} max={1000} id="feeBps" name="feeBps" marginTop="2px" value={form.feeBps} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="prizeFeeShareBps">Prize share of fees (bps)</label>
          <Input required type="number" min={0} max={10000} id="prizeFeeShareBps" name="prizeFeeShareBps" marginTop="2px" value={form.prizeFeeShareBps} onChange={handleInputChange} />
        </Box>
      </Flex>

      <Flex gap={4} alignItems="center" marginBottom="16px" wrap="wrap">
        <FormLabel htmlFor="isDynamic" mb={0} fontSize="sm">
          Dynamic pm-AMM (liquidity decays √(T−t), uniform LVR)
        </FormLabel>
        <Switch id="isDynamic" name="isDynamic" isChecked={form.isDynamic} onChange={(e) => setForm((prev) => ({ ...prev, isDynamic: e.target.checked }))} />
        {form.isDynamic && (
          <Box flex={1} minW="200px">
            <label htmlFor="liquidityPeriodMinutes">Liquidity period (min)</label>
            <Input type="number" min={0} step="any" id="liquidityPeriodMinutes" name="liquidityPeriodMinutes" marginTop="2px" value={form.liquidityPeriodMinutes} onChange={handleInputChange} />
          </Box>
        )}
      </Flex>

      <Text fontWeight="bold" fontSize="sm" mb={2}>
        Resolution policy (immutable after creation)
      </Text>

      <Flex gap={4} alignItems="center" marginBottom="12px">
        <FormLabel htmlFor="operatorResolution" mb={0} fontSize="sm">
          T0 — operator resolution enabled
        </FormLabel>
        <Switch id="operatorResolution" isChecked={form.operatorResolution} onChange={(e) => setForm((prev) => ({ ...prev, operatorResolution: e.target.checked }))} />
      </Flex>

      <label htmlFor="sources">Allowlisted source URIs (comma-separated)</label>
      <Input
        type="text"
        marginBottom="12px"
        marginTop="2px"
        id="sources"
        name="sources"
        placeholder="https://api.opta.example/result, https://backup.example/score"
        value={form.sources}
        onChange={handleInputChange}
      />

      <label htmlFor="reporters">T2 reporter party ids (comma-separated)</label>
      <Input type="text" marginBottom="12px" marginTop="2px" id="reporters" name="reporters" placeholder="reporter1::1220…, reporter2::1220…" value={form.reporters} onChange={handleInputChange} />

      <Flex gap={4} marginBottom="16px" direction={{ base: "column", md: "row" }}>
        <Box flex={1}>
          <label htmlFor="quorum">T2 quorum (M-of-N)</label>
          <Input type="number" min={0} id="quorum" name="quorum" marginTop="2px" value={form.quorum} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="challengeHours">T3 challenge window (hours, 0 = off)</label>
          <Input type="number" min={0} step="any" id="challengeHours" name="challengeHours" marginTop="2px" value={form.challengeHours} onChange={handleInputChange} />
        </Box>
        <Box flex={1}>
          <label htmlFor="bondCC">T3 bond (CC)</label>
          <Input type="number" min={0} step="any" id="bondCC" name="bondCC" marginTop="2px" value={form.bondCC} onChange={handleInputChange} />
        </Box>
      </Flex>

      <label htmlFor="reason">Audit note (optional)</label>
      <Input type="text" marginBottom="16px" marginTop="2px" id="reason" name="reason" placeholder="why this market exists / ticket id" value={form.reason} onChange={handleInputChange} />

      <Text fontSize="xs" color="gray.500" mb={3}>
        Seeding at {form.initialProbability}% with {form.initialValueCC} CC pool value costs ≈ {seedCost.toFixed(2)} CC of collateral (max of the optimal YES/NO reserves), paid by the
        treasury. Every market is binary Yes / No; Void is a first-class outcome. The backend refuses an unknown or archived event and a ticker that is already taken, then the
        Enterprise Wallet signs <code className="font-mono">MarketCounter.CreateMarket</code> as the treasury.
      </Text>

      <Button type="submit" colorScheme="green" isDisabled={busy !== null || !formValid} isLoading={busy === BUSY_KEY} loadingText="Submitting…">
        Create pm-AMM market
      </Button>
    </form>
  );
}
