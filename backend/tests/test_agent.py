import asyncio, json, os
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from app import db
from app.agent.agent import run_chat
from app.agent.llm import LLMUnavailable
from app.services import catalog, inquiries as inq


class FakeLLM:
    """Scripted turns: each is a list of ('text', str) / ('tool_calls', [...]) events."""
    configured = True
    def __init__(self, turns): self.turns, self.calls, self.seen = list(turns), 0, []
    async def stream(self, messages, tools=None):
        self.seen.append(messages)
        for ev in self.turns[self.calls]:
            yield ev
        self.calls += 1


def tc(name, **args): return ("tool_calls", [{"id": f"c_{name}", "name": name, "arguments": json.dumps(args, ensure_ascii=False)}])
def collect(sid, msg, llm): 
    async def go(): return [e async for e in run_chat(sid, msg, llm)]
    return asyncio.run(go())


def _pid():
    con = db.connect()
    return next(p for p in catalog.search_products(con, "هندزفری", limit=60)["items"] if p["shop_count"] >= 3)["product_id"]


def test_search_then_shops_emits_blocks_and_text():
    pid = _pid()
    llm = FakeLLM([[tc("search_products", query="هندزفری", price_max=3000000)],
                   [tc("find_shops", product_id=pid)],
                   [("text", "این گزینه را پیشنهاد می‌کنم؛ قدم بعدی استعلام است.")]])
    ev = collect("agent-1", "هندزفری زیر ۳ میلیون", llm)
    kinds = [e["type"] for e in ev]
    assert kinds[-1] == "done" and "text" in kinds
    blocks = [e["block"]["type"] for e in ev if e["type"] == "block"]
    assert blocks == ["product_cards", "shop_list"]
    # tool results fed back to the LLM are compact, grounded and contain no UI-only bulk
    tool_msgs = [m for m in llm.seen[-1] if m["role"] == "tool"]
    assert len(tool_msgs) == 2 and "listed_shops" in tool_msgs[1]["content"]
    # history persisted for the next turn
    st = inq.get_session(db.connect(), "agent-1")
    assert st["chat"][0]["role"] == "user" and st["chat"][-1]["role"] == "assistant"


def test_ask_user_stops_turn_with_chips():
    llm = FakeLLM([[tc("ask_user", question="برای چه کاری؟", options=["ورزش", "تماس کاری"])]])
    ev = collect("agent-2", "هندزفری می‌خوام", llm)
    chips = [e["block"] for e in ev if e["type"] == "block"]
    assert chips and chips[0]["type"] == "chips" and chips[0]["options"] == ["ورزش", "تماس کاری"]
    assert llm.calls == 1, "must not keep looping after a clarifying question"


def test_propose_inquiry_never_sends():
    pid = _pid()
    con = db.connect()
    shops = catalog.find_shops(con, [pid], include_category_only=False)["listed"][:2]
    before = con.execute("SELECT COUNT(*) FROM inquiries").fetchone()[0]
    llm = FakeLLM([[tc("propose_inquiry", product_id=pid, shop_ids=[s["shop_id"] for s in shops], questions=["stock", "price"])],
                   [("text", "برای تأیید دکمه را بزنید.")]])
    ev = collect("agent-3", "از این دو فروشگاه بپرس", llm)
    assert any(e["type"] == "block" and e["block"]["type"] == "inquiry_proposal" for e in ev)
    assert db.connect().execute("SELECT COUNT(*) FROM inquiries").fetchone()[0] == before, "agent must not message sellers itself"


def test_llm_down_falls_back_to_rule_based_search():
    class Down:
        configured = False
        async def stream(self, m, t=None):
            raise LLMUnavailable("no key")
            yield
    ev = collect("agent-4", "یه هندزفری بی‌سیم برای ورزش زیر ۳ میلیون", Down())
    assert ev[0]["type"] == "degraded"
    assert any(e["type"] == "block" and e["block"]["type"] == "product_cards" and e["block"]["items"] for e in ev)
    assert ev[-1]["type"] == "done"


def test_bad_tool_args_do_not_crash():
    llm = FakeLLM([[("tool_calls", [{"id": "x", "name": "find_shops", "arguments": "{not json"}])], [("text", "ببخشید.")]])
    ev = collect("agent-5", "x", llm)
    assert ev[-1]["type"] == "done"


def test_endless_searching_is_cut_off_and_only_last_list_shown():
    """Regression (real LLM looped 5 searches, spamming lists): one product list per turn, final step has no tools."""
    searches = [[tc("search_products", query="هندزفری")] for _ in range(3)]
    seen_tools = []
    class L(FakeLLM):
        async def stream(self, messages, tools=None):
            seen_tools.append(tools)
            async for ev in super().stream(messages, tools):
                yield ev
    llm = L(searches + [[("text", "نتیجهٔ نهایی.")]])
    ev = collect("agent-6", "هندزفری", llm)
    cards = [e for e in ev if e["type"] == "block" and e["block"]["type"] == "product_cards"]
    assert len(cards) == 1, "intermediate search results must not be shown"
    assert seen_tools[-1] is None and all(t for t in seen_tools[:-1]), "last step must force a text answer"
    assert ev[-1]["type"] == "done" and any(e["type"] == "text" for e in ev)
