/** 国土数値情報 A54（大規模盛土造成地）の静的タイル `/data/a54/{A54_TILE_Z}/{x}/{y}.json` のズームレベル */
export const A54_TILE_Z = 10

/** 昔の標高（dem_png = DEM10B）を読むズームレベル */
export const PAST_Z = 14

/** ずれの 2 回目の中央値から外す、1 回目の中央値との差の上限（m）。盛土の台など大きな差を除く */
export const OFFSET_EXCLUDE_M = 5

/** 盛土の候補にする標高差（補正後の今 − 昔）の下限（m） */
export const FILL_THRESHOLD_M = 5

/** 盛土の候補にするかたまりの面積の下限（m²）。これより小さいかたまりは捨てる */
export const FILL_MIN_AREA_M2 = 500
