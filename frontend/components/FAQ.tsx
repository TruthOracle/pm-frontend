import React, { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { enabledCollaterals, instrumentLabel, rewardsInstrument, useInstruments, type ApiInstrument } from "@/lib/instruments";

type FAQItemProps = {
  question: string;
  answer: string;
};

/** "cBYN", or "Canton Coin (CC) or Canton Belarusian Ruble (cBYN)" — the collateral instruments the catalog enables. */
function collateralPhrase(collaterals: ApiInstrument[]): string {
  const names = collaterals.map(instrumentLabel);
  if (names.length === 0) return "the collateral token each market trades in";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The copy names the instruments the deployment actually trades in (the backend's instrument
 * catalog), so a DevNet with Canton Coin and a MainNet with cBYN read correctly from one text.
 */
function buildFaq(instruments: ApiInstrument[] | undefined): FAQItemProps[] {
  const collaterals = enabledCollaterals(instruments);
  const rewards = rewardsInstrument(instruments);
  const collateral = collateralPhrase(collaterals);
  const supported =
    collaterals.length === 0
      ? "Every market is denominated in a CIP-56 token on the Canton Network and shows the token it trades in; deposits and withdrawals move that token between your Cantor8 wallet and your in-app balance."
      : `Markets are denominated in ${collateral} — CIP-56 tokens on the Canton Network — and every market shows the token it trades in. Deposits and withdrawals move that token between your Cantor8 wallet and your in-app balance.${rewards ? ` Rewards are paid in ${instrumentLabel(rewards)}.` : ""}`;
  return [
    {
      question: "What is TruthOracle?",
      answer:
        "TruthOracle is a decentralized prediction market platform built on the Canton Network. It allows users to create, participate in, and resolve prediction markets on various topics, including politics, climate change, sports, and more, all while enjoying low transaction fees and a user-friendly experience.",
    },
    {
      question: "How does TruthOracle work?",
      answer:
        "TruthOracle leverages the power of blockchain technology to decentralize prediction markets. Users can create markets by defining an event and possible outcomes, then other users can place predictions on those outcomes. The platform uses smart contracts to automate the resolution of these markets, ensuring a fair and transparent process.",
    },
    {
      question: "What makes TruthOracle different from other prediction markets?",
      answer:
        "TruthOracle stands out because of its low transaction fees, thanks to the efficiency of the Canton Network. Additionally, our platform offers a fully decentralized experience, removing the need for intermediaries and ensuring complete transparency and security for all users.",
    },
    {
      question: "Are my bets and positions private?",
      answer:
        "Yes. Bets placed on TruthOracle are private. Others cannot see your positions on chain. Your activity and holdings in prediction markets are not visible to other participants.",
    },
    {
      question: "What types of predictions can I make on TruthOracle?",
      answer:
        "You can make predictions on a wide range of topics, including political elections, climate change scenarios, sports events, and other significant occurrences. We continually expand our categories to include new and exciting areas of interest.",
    },
    {
      question: "How do I start using TruthOracle?",
      answer: `Sign in with Google or Telegram to create your account — that account holds your balance and your identity verification. Then connect your Cantor8 wallet and link it to the account: the wallet signs your trades and is where deposits come from and withdrawals go. Deposit some ${collateral} and you can trade.`,
    },
    {
      question: "What tokens are supported on TruthOracle?",
      answer: supported,
    },
    {
      question: "How are outcomes of prediction markets resolved?",
      answer:
        "Outcomes are resolved automatically through smart contracts using trusted data oracles that provide real-world data. This ensures a fair and transparent outcome for every market on the platform.",
    },
  ];
}

const FAQ = () => {
  const instruments = useInstruments();
  const faqData = buildFaq(instruments.data);
  return (
    <section className="page-container py-10 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-primary">
            <HelpCircle className="h-3.5 w-3.5" />
            Help center
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            Frequently Asked Questions
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Everything you need to understand markets, wallets, outcomes, and settlement on TruthOracle.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          {faqData.map((item, index) => (
            <FAQItem key={index} question={item.question} answer={item.answer} isLast={index === faqData.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
};

const FAQItem: React.FC<FAQItemProps & { isLast: boolean }> = ({ question, answer, isLast }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={cn("border-slate-200", !isLast && "border-b")}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 sm:px-6"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="text-sm font-bold text-slate-950 sm:text-base">{question}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", isOpen && "rotate-180 text-primary")}
        />
      </button>
      {isOpen && <p className="px-5 pb-5 text-sm leading-6 text-slate-600 sm:px-6">{answer}</p>}
    </div>
  );
};

export default FAQ;
