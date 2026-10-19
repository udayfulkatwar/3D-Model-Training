"""Unit conversions. Internal unit is the metre; convert only at the edges.

Exact definitions: 1 ft = 0.3048 m (international foot, 1959), so
1 m^2 = 1 / 0.3048^2 ft^2.
"""

M_PER_FT = 0.3048
SQFT_PER_SQM = 1.0 / (M_PER_FT * M_PER_FT)  # 10.763910416709722


def sqm_to_sqft(area_m2: float) -> float:
    return area_m2 * SQFT_PER_SQM


def m_to_mm(length_m: float) -> float:
    return length_m * 1000.0
