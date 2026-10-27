from decimal import Decimal


def run(payload):
    """A deterministic reorder calculation; no AI provider or network needed."""
    suggestions = []
    for row in payload.get('products', []):
        demand = Decimal(str(row['daily_demand']))
        lead_days = Decimal(str(row['lead_days']))
        safety = Decimal(str(row.get('safety_stock', 0)))
        current = Decimal(str(row['stock']))
        target = demand * lead_days + safety
        if current < target:
            suggestions.append({'sku': row['sku'], 'reorder_quantity': int((target-current).to_integral_value(rounding='ROUND_CEILING'))})
    print(f'Calculated reorder needs for {len(payload.get("products", []))} products')
    return {'reorders': suggestions, 'count': len(suggestions)}
