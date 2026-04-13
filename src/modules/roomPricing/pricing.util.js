const pad = (value) => String(value).padStart(2, "0");

const normalizeDateKey = (value) => {
  if (!value) return null;

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const toUtcDate = (value) => {
  const dateKey = normalizeDateKey(value);

  if (!dateKey) {
    return null;
  }

  return new Date(`${dateKey}T00:00:00.000Z`);
};

const buildDateKeys = ({ startDate, endDate, inclusiveEnd = true }) => {
  const start = toUtcDate(startDate);
  const end = toUtcDate(endDate);

  if (!start || !end || end < start) {
    return [];
  }

  const result = [];
  const cursor = new Date(start);
  const endTime = end.getTime();

  while (cursor.getTime() < endTime || (inclusiveEnd && cursor.getTime() === endTime)) {
    result.push(normalizeDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
};

const buildStayDateKeys = ({ checkInDate, checkOutDate }) =>
  buildDateKeys({
    startDate: checkInDate,
    endDate: normalizeDateKey(checkOutDate),
    inclusiveEnd: false,
  });

module.exports = {
  normalizeDateKey,
  buildDateKeys,
  buildStayDateKeys,
};
