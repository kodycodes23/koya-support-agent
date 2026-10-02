import { describe, expect, it } from "vitest";
import { callbackTimeProblem, timesIn } from "../src/working-hours.ts";

const ok = (t: string) => expect(callbackTimeProblem(t), t).toBeNull();
const refused = (t: string) => expect(callbackTimeProblem(t), t).not.toBeNull();

describe("callback booking hours (9:30am to 4:30pm)", () => {
  it("accepts times inside the window, including its edges", () => {
    for (const t of ["tomorrow at 10am", "Friday 9:30am", "4:30 pm on Monday", "at 2", "around noon", "14:15", "ten a.m.", "3 o'clock", "between 10 and 11am", "Tuesday at 12"]) ok(t);
  });
  it("refuses opening and closing time, the first and last 30 minutes, and outside hours", () => {
    for (const t of ["tomorrow at 9am", "9:15am", "at 5pm", "4:45 pm", "at 5", "8am", "7:30 in the morning", "6pm", "at 8", "between 4 and 6pm", "this evening", "tonight", "midnight"]) refused(t);
  });
  it("accepts phrases with no clock time, so the specialist can pick one", () => {
    for (const t of ["tomorrow morning", "Monday", "any time on Friday", "October 3rd", "the 12th in the afternoon"]) ok(t);
  });
  it("reads am/pm, 24-hour and spoken times", () => {
    expect(timesIn("tomorrow at 2:30pm")).toEqual([14 * 60 + 30]);
    expect(timesIn("ten am")).toEqual([600]);
    expect(timesIn("17:00")).toEqual([17 * 60]);
  });
});
