/* eslint-env node */
export async function load(url) {
  let attempts = 0;
  attempts = 1;
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    throw new Error(`could not load ${url}`);
  }
}
