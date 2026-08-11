// Player-to-player trading: propose (current turn player only), respond
// (any other player, whether or not it's their turn), and confirm/cancel
// (proposer only, once at least one target has accepted). Mirrors the
// physical game's "shout an offer, whoever agrees passes their card over,
// you pick who to actually swap with" flow — see tradeRules.ts.

import { useState } from "react";
import { GameState, TradeOffer } from "@/lib/game/state";
import { Resource } from "@/lib/game/types";

const RESOURCE_ICONS: Record<Resource, string> = {
  wood: "🪵",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
};
const RESOURCES = Object.keys(RESOURCE_ICONS) as Resource[];

function resourceSummary(resources: Partial<Record<Resource, number>>): string {
  return (
    Object.entries(resources)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([r, n]) => `${RESOURCE_ICONS[r as Resource]}${n}`)
      .join(" ") || "—"
  );
}

function ResourceStepper({
  selection,
  onChange,
  max,
}: {
  selection: Record<Resource, number>;
  onChange: (next: Record<Resource, number>) => void;
  /** Upper bound per resource — the proposer's own hand when picking what
   * to offer, or a generous flat cap when picking what to request (there's
   * nothing of the counterparty's hand to check against client-side). */
  max: Record<Resource, number> | number;
}) {
  function limitFor(r: Resource) {
    return typeof max === "number" ? max : max[r];
  }
  return (
    <div className="flex flex-col gap-1">
      {RESOURCES.map((r) => (
        <div key={r} className="flex items-center justify-between gap-2 text-sm">
          <span>{RESOURCE_ICONS[r]}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange({ ...selection, [r]: Math.max(0, selection[r] - 1) })}
              disabled={selection[r] <= 0}
              className="h-5 w-5 rounded border border-black/20 text-xs disabled:opacity-30"
            >
              −
            </button>
            <span className="w-4 text-center">{selection[r]}</span>
            <button
              onClick={() => onChange({ ...selection, [r]: Math.min(limitFor(r), selection[r] + 1) })}
              disabled={selection[r] >= limitFor(r)}
              className="h-5 w-5 rounded border border-black/20 text-xs disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const EMPTY: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };

const TradePanel = ({
  game,
  playerId,
  isMyTurn,
  onPropose,
  onRespond,
  onConfirm,
  onCancel,
}: {
  game: GameState;
  playerId: string;
  isMyTurn: boolean;
  onPropose: (
    offering: Partial<Record<Resource, number>>,
    requesting: Partial<Record<Resource, number>>,
    targetPlayerId: string | null
  ) => void;
  onRespond: (tradeId: string, response: "accepted" | "rejected") => void;
  onConfirm: (tradeId: string, counterpartyId: string) => void;
  onCancel: (tradeId: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [offering, setOffering] = useState<Record<Resource, number>>(EMPTY);
  const [requesting, setRequesting] = useState<Record<Resource, number>>(EMPTY);
  const [target, setTarget] = useState<string>("");

  const self = game.players.find((p) => p.playerId === playerId)!;
  const others = game.players.filter((p) => p.playerId !== playerId);

  const myTrades = game.pendingTrades.filter((t) => t.proposerId === playerId);
  const incoming = game.pendingTrades.filter(
    (t) => t.proposerId !== playerId && (t.targetPlayerId === null || t.targetPlayerId === playerId)
  );

  function submitPropose() {
    const offeringPayload = Object.fromEntries(Object.entries(offering).filter(([, n]) => n > 0));
    const requestingPayload = Object.fromEntries(Object.entries(requesting).filter(([, n]) => n > 0));
    onPropose(offeringPayload, requestingPayload, target || null);
    setOffering(EMPTY);
    setRequesting(EMPTY);
    setTarget("");
    setOpen(false);
  }

  const offeringTotal = Object.values(offering).reduce((a, b) => a + b, 0);
  const requestingTotal = Object.values(requesting).reduce((a, b) => a + b, 0);

  function nicknameOf(pid: string) {
    return game.players.find((p) => p.playerId === pid)?.nickname ?? "Someone";
  }

  function TradeRow({ trade, mine }: { trade: TradeOffer; mine: boolean }) {
    const myResponse = trade.respondedBy[playerId];
    const accepters = Object.entries(trade.respondedBy).filter(([, r]) => r === "accepted").map(([pid]) => pid);
    return (
      <div className="flex flex-col gap-1 rounded-md border border-black/20 px-3 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span>
            {mine ? "You" : nicknameOf(trade.proposerId)} offer {resourceSummary(trade.offering)} for{" "}
            {resourceSummary(trade.requesting)}
            {trade.targetPlayerId && ` (to ${nicknameOf(trade.targetPlayerId)})`}
          </span>
        </div>
        {mine ? (
          <div className="flex flex-wrap items-center gap-2">
            {accepters.length === 0 && <span className="text-black/40">Waiting for a response…</span>}
            {accepters.map((pid) => (
              <button
                key={pid}
                onClick={() => onConfirm(trade.id, pid)}
                className="rounded border border-green-600 px-2 py-0.5 text-green-700 hover:bg-green-50"
              >
                Confirm with {nicknameOf(pid)}
              </button>
            ))}
            <button onClick={() => onCancel(trade.id)} className="text-black/40 underline">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRespond(trade.id, "accepted")}
              disabled={myResponse === "accepted"}
              className="rounded border border-green-600 px-2 py-0.5 text-green-700 disabled:opacity-40"
            >
              Accept
            </button>
            <button
              onClick={() => onRespond(trade.id, "rejected")}
              disabled={myResponse === "rejected"}
              className="rounded border border-red-600 px-2 py-0.5 text-red-700 disabled:opacity-40"
            >
              Reject
            </button>
            {myResponse && <span className="text-black/40">You {myResponse}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      {isMyTurn && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={() => setOpen(!open)} className="text-xs font-medium text-indigo-600 underline">
            {open ? "Cancel proposing a trade" : "Propose a player trade"}
          </button>
          {open && (
            <div className="flex flex-col items-center gap-3 rounded-md border border-indigo-300 bg-indigo-50 px-4 py-3">
              <div className="flex gap-6">
                <div>
                  <span className="text-xs text-black/50">You give</span>
                  <ResourceStepper selection={offering} onChange={setOffering} max={self.resources} />
                </div>
                <div>
                  <span className="text-xs text-black/50">You want</span>
                  <ResourceStepper selection={requesting} onChange={setRequesting} max={10} />
                </div>
              </div>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="rounded border border-black/20 px-2 py-1 text-xs"
              >
                <option value="">Open to everyone</option>
                {others.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    Only {p.nickname}
                  </option>
                ))}
              </select>
              <button
                onClick={submitPropose}
                disabled={offeringTotal === 0 || requestingTotal === 0}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Propose trade
              </button>
            </div>
          )}
        </div>
      )}

      {(myTrades.length > 0 || incoming.length > 0) && (
        <div className="flex w-full flex-col gap-2">
          {myTrades.map((t) => (
            <TradeRow key={t.id} trade={t} mine />
          ))}
          {incoming.map((t) => (
            <TradeRow key={t.id} trade={t} mine={false} />
          ))}
        </div>
      )}
    </div>
  );
};
export default TradePanel;
