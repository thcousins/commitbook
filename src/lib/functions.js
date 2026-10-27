// Spreadsheet functions for the formula helper: syntax and a one-line description.
// The engine (HyperFormula) supports more than are described here; those still appear
// in the list, under "Other", with just their name.

const F = (group, syntax, text) => ({ group, syntax, text, name: syntax.slice(0, syntax.indexOf('(')) });

export const GROUPS = ['Maths', 'Logic', 'Text', 'Date and time', 'Lookup', 'Statistics', 'Finance', 'Information', 'Other'];

export const FUNCTIONS = [
  // Maths
  F('Maths', 'SUM(number1, [number2], …)', 'Adds numbers or ranges.'),
  F('Maths', 'SUMIF(range, criteria, [sum_range])', 'Adds the cells that meet one condition, e.g. =SUMIF(C:C, "Ordered", D:D).'),
  F('Maths', 'SUMIFS(sum_range, range1, criteria1, …)', 'Adds the cells that meet several conditions.'),
  F('Maths', 'SUMPRODUCT(array1, [array2], …)', 'Multiplies matching items in ranges and adds the results.'),
  F('Maths', 'SUMSQ(number1, …)', 'Adds the squares of the numbers.'),
  F('Maths', 'PRODUCT(number1, …)', 'Multiplies numbers together.'),
  F('Maths', 'ROUND(number, digits)', 'Rounds to a number of decimal places.'),
  F('Maths', 'ROUNDUP(number, digits)', 'Rounds up, away from zero.'),
  F('Maths', 'ROUNDDOWN(number, digits)', 'Rounds down, towards zero.'),
  F('Maths', 'MROUND(number, multiple)', 'Rounds to the nearest multiple, e.g. =MROUND(A1, 5).'),
  F('Maths', 'CEILING(number, significance)', 'Rounds up to the nearest multiple.'),
  F('Maths', 'FLOOR(number, significance)', 'Rounds down to the nearest multiple.'),
  F('Maths', 'INT(number)', 'Rounds down to a whole number.'),
  F('Maths', 'TRUNC(number, [digits])', 'Cuts off the decimal part without rounding.'),
  F('Maths', 'ABS(number)', 'The number without its sign.'),
  F('Maths', 'MOD(number, divisor)', 'The remainder after dividing.'),
  F('Maths', 'QUOTIENT(numerator, denominator)', 'The whole-number part of a division.'),
  F('Maths', 'POWER(number, power)', 'A number raised to a power (same as ^).'),
  F('Maths', 'SQRT(number)', 'Square root.'),
  F('Maths', 'EXP(number)', 'e raised to a power.'),
  F('Maths', 'LN(number)', 'Natural logarithm.'),
  F('Maths', 'LOG(number, [base])', 'Logarithm to a base (10 if left out).'),
  F('Maths', 'LOG10(number)', 'Base-10 logarithm.'),
  F('Maths', 'PI()', 'The number π.'),
  F('Maths', 'SIGN(number)', '1 if positive, -1 if negative, 0 if zero.'),
  F('Maths', 'EVEN(number)', 'Rounds up to the next even whole number.'),
  F('Maths', 'ODD(number)', 'Rounds up to the next odd whole number.'),
  F('Maths', 'FACT(number)', 'Factorial (1 × 2 × … × n).'),
  F('Maths', 'GCD(number1, …)', 'Greatest common divisor.'),
  F('Maths', 'LCM(number1, …)', 'Lowest common multiple.'),
  F('Maths', 'COMBIN(n, k)', 'Number of ways to choose k items from n.'),
  F('Maths', 'RAND()', 'A random number between 0 and 1 (changes each time).'),
  F('Maths', 'RANDBETWEEN(bottom, top)', 'A random whole number in a range.'),
  F('Maths', 'SUBTOTAL(function_number, range1, …)', 'A total of a chosen kind (9 = sum, 1 = average, 2 = count…).'),
  F('Maths', 'SIN(angle)', 'Sine of an angle in radians.'),
  F('Maths', 'COS(angle)', 'Cosine of an angle in radians.'),
  F('Maths', 'TAN(angle)', 'Tangent of an angle in radians.'),
  F('Maths', 'RADIANS(degrees)', 'Converts degrees to radians.'),
  F('Maths', 'DEGREES(radians)', 'Converts radians to degrees.'),
  F('Maths', 'ROMAN(number)', 'A number as Roman numerals.'),

  // Logic
  F('Logic', 'IF(test, value_if_true, [value_if_false])', 'One value if a test is true, another if not, e.g. =IF(D1>100, "Over", "OK").'),
  F('Logic', 'IFS(test1, value1, [test2, value2], …)', 'The value for the first test that is true.'),
  F('Logic', 'IFERROR(value, value_if_error)', 'A fallback when a formula gives an error.'),
  F('Logic', 'IFNA(value, value_if_na)', 'A fallback when a lookup finds nothing (#N/A).'),
  F('Logic', 'AND(test1, [test2], …)', 'TRUE if every test is true.'),
  F('Logic', 'OR(test1, [test2], …)', 'TRUE if any test is true.'),
  F('Logic', 'NOT(test)', 'Reverses TRUE and FALSE.'),
  F('Logic', 'XOR(test1, [test2], …)', 'TRUE if an odd number of tests are true.'),
  F('Logic', 'SWITCH(value, case1, result1, …, [default])', 'Picks a result by matching a value against a list.'),
  F('Logic', 'CHOOSE(index, value1, [value2], …)', 'Picks the nth value from a list.'),
  F('Logic', 'TRUE()', 'The value TRUE.'),
  F('Logic', 'FALSE()', 'The value FALSE.'),

  // Text
  F('Text', 'CONCATENATE(text1, [text2], …)', 'Joins text together (or use &).'),
  F('Text', 'TEXTJOIN(delimiter, ignore_empty, text1, …)', 'Joins text with a separator, e.g. =TEXTJOIN(", ", TRUE, A:A).'),
  F('Text', 'LEFT(text, [count])', 'The first characters of some text.'),
  F('Text', 'RIGHT(text, [count])', 'The last characters of some text.'),
  F('Text', 'MID(text, start, count)', 'Characters from the middle of some text.'),
  F('Text', 'LEN(text)', 'The number of characters.'),
  F('Text', 'UPPER(text)', 'Converts to CAPITALS.'),
  F('Text', 'LOWER(text)', 'Converts to lower case.'),
  F('Text', 'PROPER(text)', 'Capitalises Each Word.'),
  F('Text', 'TRIM(text)', 'Removes extra spaces.'),
  F('Text', 'CLEAN(text)', 'Removes characters that can’t be printed.'),
  F('Text', 'FIND(find_text, within_text, [start])', 'Position of some text (case-sensitive).'),
  F('Text', 'SEARCH(find_text, within_text, [start])', 'Position of some text (ignores case, allows * and ?).'),
  F('Text', 'SUBSTITUTE(text, old_text, new_text, [instance])', 'Replaces some text with other text.'),
  F('Text', 'REPLACE(text, start, count, new_text)', 'Replaces characters at a position.'),
  F('Text', 'REPT(text, times)', 'Repeats text a number of times.'),
  F('Text', 'EXACT(text1, text2)', 'TRUE if two texts are exactly the same.'),
  F('Text', 'TEXT(value, format)', 'Formats a number or date as text, e.g. =TEXT(A1, "dd/mm/yyyy").'),
  F('Text', 'VALUE(text)', 'Converts text that looks like a number into a number.'),
  F('Text', 'SPLIT(text, index)', 'The nth word of some text (split on spaces).'),
  F('Text', 'CHAR(number)', 'The character for a code number.'),
  F('Text', 'CODE(text)', 'The code number of the first character.'),
  F('Text', 'T(value)', 'The value if it’s text, otherwise nothing.'),
  F('Text', 'HYPERLINK(url, [label])', 'A link.'),

  // Date and time
  F('Date and time', 'TODAY()', 'Today’s date.'),
  F('Date and time', 'NOW()', 'The date and time now.'),
  F('Date and time', 'DATE(year, month, day)', 'Makes a date from its parts, e.g. =DATE(2026, 10, 27).'),
  F('Date and time', 'TIME(hour, minute, second)', 'Makes a time from its parts.'),
  F('Date and time', 'DAY(date)', 'The day of the month (1–31).'),
  F('Date and time', 'MONTH(date)', 'The month (1–12).'),
  F('Date and time', 'YEAR(date)', 'The year.'),
  F('Date and time', 'HOUR(time)', 'The hour (0–23).'),
  F('Date and time', 'MINUTE(time)', 'The minute (0–59).'),
  F('Date and time', 'SECOND(time)', 'The second (0–59).'),
  F('Date and time', 'WEEKDAY(date, [type])', 'Day of the week as a number (1 = Sunday, or type 2 for 1 = Monday).'),
  F('Date and time', 'WEEKNUM(date, [type])', 'Week number in the year.'),
  F('Date and time', 'ISOWEEKNUM(date)', 'ISO week number (weeks start on Monday).'),
  F('Date and time', 'DAYS(end_date, start_date)', 'Number of days between two dates.'),
  F('Date and time', 'DATEDIF(start_date, end_date, unit)', 'Time between dates in "D" days, "M" months or "Y" years.'),
  F('Date and time', 'EDATE(date, months)', 'The same day some months before or after.'),
  F('Date and time', 'EOMONTH(date, months)', 'The last day of the month, some months away.'),
  F('Date and time', 'NETWORKDAYS(start_date, end_date, [holidays])', 'Number of working days (Monday to Friday) between dates.'),
  F('Date and time', 'NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])', 'Working days between dates, with your own weekend days.'),
  F('Date and time', 'WORKDAY(start_date, days, [holidays])', 'The date some working days away.'),
  F('Date and time', 'WORKDAY.INTL(start_date, days, [weekend], [holidays])', 'The date some working days away, with your own weekend days.'),
  F('Date and time', 'YEARFRAC(start_date, end_date, [basis])', 'The fraction of a year between two dates.'),
  F('Date and time', 'DAYS360(start_date, end_date, [method])', 'Days between dates on a 360-day year.'),
  F('Date and time', 'DATEVALUE(text)', 'Converts text such as "27/10/2026" into a date.'),
  F('Date and time', 'TIMEVALUE(text)', 'Converts text such as "14:30" into a time.'),

  // Lookup
  F('Lookup', 'XLOOKUP(lookup, lookup_range, return_range, [if_not_found])', 'Finds a value in one column and returns the matching value from another.'),
  F('Lookup', 'VLOOKUP(lookup, table, column_number, [approximate])', 'Finds a value in the first column of a table; use FALSE for an exact match.'),
  F('Lookup', 'HLOOKUP(lookup, table, row_number, [approximate])', 'Like VLOOKUP, but searches across the top row.'),
  F('Lookup', 'MATCH(lookup, range, [match_type])', 'The position of a value in a range (0 = exact match).'),
  F('Lookup', 'INDEX(range, row, [column])', 'The value at a row and column of a range.'),
  F('Lookup', 'OFFSET(reference, rows, columns, [height], [width])', 'A range a number of rows and columns away.'),
  F('Lookup', 'ROW([reference])', 'The row number of a cell.'),
  F('Lookup', 'COLUMN([reference])', 'The column number of a cell.'),
  F('Lookup', 'ROWS(range)', 'The number of rows in a range.'),
  F('Lookup', 'COLUMNS(range)', 'The number of columns in a range.'),
  F('Lookup', 'ADDRESS(row, column, [absolute])', 'A cell reference as text, e.g. "$B$3".'),
  F('Lookup', 'FILTER(range, include)', 'The rows of a range that meet a condition.'),
  F('Lookup', 'SORT(range, [column], [ascending])', 'A range sorted by a column.'),
  F('Lookup', 'UNIQUE(range)', 'The distinct values in a range.'),
  F('Lookup', 'TRANSPOSE(range)', 'Swaps rows and columns.'),
  F('Lookup', 'SEQUENCE(rows, [columns], [start], [step])', 'A list of numbers in sequence.'),

  // Statistics
  F('Statistics', 'AVERAGE(number1, …)', 'The average (mean).'),
  F('Statistics', 'AVERAGEIF(range, criteria, [average_range])', 'The average of the cells that meet a condition.'),
  F('Statistics', 'AVERAGEA(value1, …)', 'Average, counting text as 0 and TRUE as 1.'),
  F('Statistics', 'MEDIAN(number1, …)', 'The middle value.'),
  F('Statistics', 'MIN(number1, …)', 'The smallest number.'),
  F('Statistics', 'MAX(number1, …)', 'The largest number.'),
  F('Statistics', 'MINIFS(min_range, range1, criteria1, …)', 'The smallest number among cells that meet conditions.'),
  F('Statistics', 'MAXIFS(max_range, range1, criteria1, …)', 'The largest number among cells that meet conditions.'),
  F('Statistics', 'LARGE(range, k)', 'The kth largest value, e.g. 2 for the second largest.'),
  F('Statistics', 'SMALL(range, k)', 'The kth smallest value.'),
  F('Statistics', 'COUNT(value1, …)', 'How many cells contain numbers.'),
  F('Statistics', 'COUNTA(value1, …)', 'How many cells are not empty.'),
  F('Statistics', 'COUNTBLANK(range)', 'How many cells are empty.'),
  F('Statistics', 'COUNTIF(range, criteria)', 'How many cells meet a condition, e.g. =COUNTIF(C:C, "Booked").'),
  F('Statistics', 'COUNTIFS(range1, criteria1, …)', 'How many rows meet several conditions.'),
  F('Statistics', 'COUNTUNIQUE(value1, …)', 'How many different values there are.'),
  F('Statistics', 'PERCENTILE(range, k)', 'The value at a percentile (k between 0 and 1).'),
  F('Statistics', 'QUARTILE(range, quart)', 'A quartile (0–4) of the values.'),
  F('Statistics', 'STDEV(number1, …)', 'Standard deviation of a sample.'),
  F('Statistics', 'STDEVP(number1, …)', 'Standard deviation of a whole population.'),
  F('Statistics', 'VAR(number1, …)', 'Variance of a sample.'),
  F('Statistics', 'VARP(number1, …)', 'Variance of a whole population.'),
  F('Statistics', 'CORREL(range1, range2)', 'How closely two sets of numbers move together (-1 to 1).'),
  F('Statistics', 'SLOPE(known_y, known_x)', 'The slope of the best-fit line.'),
  F('Statistics', 'GEOMEAN(number1, …)', 'Geometric mean.'),
  F('Statistics', 'AVEDEV(number1, …)', 'Average distance of values from their mean.'),

  // Finance
  F('Finance', 'PMT(rate, periods, present_value, [future_value], [type])', 'The regular payment on a loan, e.g. =PMT(5%/12, 300, -200000).'),
  F('Finance', 'IPMT(rate, period, periods, present_value, [future_value], [type])', 'The interest part of a loan payment.'),
  F('Finance', 'PPMT(rate, period, periods, present_value, [future_value], [type])', 'The capital part of a loan payment.'),
  F('Finance', 'FV(rate, periods, payment, [present_value], [type])', 'The future value of savings or an investment.'),
  F('Finance', 'PV(rate, periods, payment, [future_value], [type])', 'The present value of future payments.'),
  F('Finance', 'NPER(rate, payment, present_value, [future_value], [type])', 'How many payments to pay off a loan or reach a target.'),
  F('Finance', 'RATE(periods, payment, present_value, [future_value], [type])', 'The interest rate per period.'),
  F('Finance', 'NPV(rate, value1, …)', 'Net present value of future cash flows.'),
  F('Finance', 'IRR(values, [guess])', 'Internal rate of return.'),
  F('Finance', 'XNPV(rate, values, dates)', 'Net present value of cash flows on given dates.'),
  F('Finance', 'XIRR(values, dates, [guess])', 'Internal rate of return for cash flows on given dates.'),
  F('Finance', 'EFFECT(nominal_rate, periods_per_year)', 'The effective annual interest rate.'),
  F('Finance', 'NOMINAL(effective_rate, periods_per_year)', 'The nominal annual interest rate.'),
  F('Finance', 'SLN(cost, salvage, life)', 'Straight-line depreciation for one period.'),
  F('Finance', 'DB(cost, salvage, life, period, [month])', 'Declining-balance depreciation.'),

  // Information
  F('Information', 'ISBLANK(value)', 'TRUE if a cell is empty.'),
  F('Information', 'ISNUMBER(value)', 'TRUE if the value is a number.'),
  F('Information', 'ISTEXT(value)', 'TRUE if the value is text.'),
  F('Information', 'ISERROR(value)', 'TRUE if the value is any error.'),
  F('Information', 'ISNA(value)', 'TRUE if the value is #N/A.'),
  F('Information', 'ISEVEN(number)', 'TRUE if the number is even.'),
  F('Information', 'ISODD(number)', 'TRUE if the number is odd.'),
  F('Information', 'ISFORMULA(reference)', 'TRUE if a cell contains a formula.'),
  F('Information', 'NA()', 'The #N/A error, meaning “no value”.'),
  F('Information', 'N(value)', 'Converts a value to a number.'),
];

const byName = new Map(FUNCTIONS.map(f => [f.name, f]));

/**
 * Every function the engine supports, described where we have a description.
 * `engineNames` comes from HyperFormula.getRegisteredFunctionNames().
 */
export function catalogue(engineNames = []) {
  const out = [...FUNCTIONS];
  for (const n of engineNames) {
    if (byName.has(n) || n.startsWith('HF.')) continue;
    out.push({ group: 'Other', name: n, syntax: `${n}(…)`, text: '' });
  }
  if (engineNames.length) {
    const supported = new Set(engineNames);
    return out.filter(f => supported.has(f.name));
  }
  return out;
}

/** Functions matching what's been typed: names starting with it first, then other matches. */
export function searchFunctions(list, query, limit = 50) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return list.slice(0, limit);
  const starts = [], inName = [], inText = [];
  for (const f of list) {
    if (f.name.startsWith(q)) starts.push(f);
    else if (f.name.includes(q)) inName.push(f);
    else if (q.length > 2 && f.text.toUpperCase().includes(q)) inText.push(f);
  }
  const rank = a => (a.group === 'Other' ? 1 : 0);
  starts.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return [...starts, ...inName, ...inText].slice(0, limit);
}

/**
 * The function name being typed at the caret in a formula, if any.
 * Returns { start, end, prefix } for the word to replace, or null.
 */
export function functionAtCaret(text, caret) {
  if (!String(text).trim().startsWith('=')) return null;
  const before = text.slice(0, caret);
  // Not inside "quoted text".
  if ((before.match(/"/g) || []).length % 2) return null;
  const m = before.match(/(^|[=(,;+\-*/^&<>:\s])([A-Za-z][A-Za-z0-9.]*)$/);
  if (!m) return null;
  const word = m[2];
  // A cell reference such as B12 isn't a function name.
  if (/^[A-Za-z]{1,3}\d+$/.test(word)) return null;
  const start = caret - word.length;
  let end = caret;
  while (end < text.length && /[A-Za-z0-9.]/.test(text[end])) end++;
  return { start, end, prefix: word };
}
