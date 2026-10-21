"""Inline trimmed fixtures from docs/fixtures into design/canvas.html (from canvas.src.html)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent
fx = root.parent / "docs" / "fixtures"
L = lambda n: json.load(open(fx / f"{n}.json"))

def shop(n, offers=3):
    d = L(n); d["offers"] = d.get("offers", [])[:offers]; d["categories"] = d.get("categories", [])[:14]; return d

md = L("mall_directory")
for f in md["floors"]:
    f["count"] = len(f["shops"]); f["shops"] = f["shops"][:6]

data = {
    "top": L("top_categories")["items"][:8],
    "malls": L("malls")["items"],
    "search": L("search_results"),
    "detail": L("product_detail"),
    "compare": L("product_compare"),
    "similar": L("similar_products")["items"][:4],
    "shops": L("shops_for_product"),
    "shopsInst": L("shops_for_product_installment_only"),
    "inq": L("inquiries_all_states")["items"],
    "edge": L("offer_edge_cases"),
    "plan": L("visit_plan_SPEC_not_yet_implemented"),
    "mall": md,
    "sd": {k: shop(k) for k in ["shop_full_hours_in_mall", "shop_suspicious_hours", "shop_real_name_with_website",
                                "shop_installment_channel_unknown", "shop_installment_in_person", "shop_no_mall_street_only",
                                "shop_fast_delivery_false", "shop_no_hours", "shop_category_only_no_offers"]},
}
src = (root / "canvas.src.html").read_text()
out = src.replace("/*__DATA__*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
(root / "canvas.html").write_text(out)
print("wrote", len(out), "bytes")
