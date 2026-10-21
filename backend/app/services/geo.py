import math

def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))

# APPROXIMATE outline of Tehran's central traffic restriction zone (طرح ترافیک), lon/lat.
# Hand-drawn from public descriptions; good enough for a "likely inside the zone" hint, never a legal claim.
TRAFFIC_ZONE = [(51.370, 35.685), (51.372, 35.7075), (51.395, 35.7140), (51.430, 35.7125), (51.447, 35.7025),
                (51.447, 35.6700), (51.420, 35.6600), (51.385, 35.6640)]

def in_polygon(lon: float, lat: float, poly=TRAFFIC_ZONE) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def in_traffic_zone(lat: float | None, lon: float | None) -> bool:
    return lat is not None and lon is not None and in_polygon(lon, lat)
