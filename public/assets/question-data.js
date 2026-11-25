export function questionData(source) {
  let data;
  try { data = JSON.parse(source); } catch { throw new Error('Questions must be valid JSON. Check commas, quotes, and brackets.'); }
  if (!Array.isArray(data) || !data.length) throw new Error('Add at least one question in a JSON array.');
  return data.map((item, index) => {
    const {prompt, options, answer, section, questionNumber} = item || {};
    if (questionNumber !== undefined &&
        !(typeof questionNumber === 'string' && /^\d{1,10}$/.test(questionNumber) && Number(questionNumber) > 0) &&
        !(Number.isSafeInteger(questionNumber) && questionNumber > 0)) {
      throw new Error(`Question ${index + 1} needs a positive source question number.`);
    }
    if (typeof prompt !== 'string' || !prompt.trim() || !Array.isArray(options) || options.length < 2 ||
        options.some(value => typeof value !== 'string' || !value.trim()) ||
        !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} needs a prompt, at least two options, and a valid zero-based answer.`);
    }
    return {prompt: prompt.trim(), options: options.map(value => value.trim()), answer,
      ...(questionNumber === undefined ? {} : {questionNumber: String(questionNumber)}),
      section: typeof section === 'string' && section.trim() ? section.trim() : 'General'};
  });
}
