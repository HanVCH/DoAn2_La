export const defaultPreferences = {currency:'VND',numberStyle:'dots',cycleStartDay:1};

export async function readPreferences(db,user) {
  const [row] = await db.execute('SELECT number_style AS numberStyle,cycle_start_day AS cycleStartDay FROM user_finance_settings WHERE user_id=?',[user]);
  return {...defaultPreferences,...row};
}
