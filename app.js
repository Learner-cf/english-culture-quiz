'use strict';

const bank = window.QUESTION_BANK;
const questionsById = new Map(bank.questions.map(question => [question.id, question]));
const examsById = new Map(bank.exams.map(exam => [exam.id, exam.title]));
const typeNames = { 'true-false': '判断题', choice: '单选题', 'multiple-choice': '多选题', fill: '填空题' };
const modeNames = { ordered: '顺序练习', shuffle: '随机练习', wrong: '错题重练' };
const storageKey = 'english-culture-quiz:v1';
const $ = id => document.getElementById(id);
const answerForm = $('answer-form');
const answerFields = $('answer-fields');
const nextButton = $('next');
const feedback = $('feedback');
const position = $('position');
const questionGrid = $('question-grid');
const summaryView = $('summary-view');
const prompt = $('prompt');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function readProgress() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? {};
  } catch {
    return {};
  }
}

const saved = readProgress();
const history = Object.fromEntries(Object.entries(saved.history ?? {}).filter(([id, result]) =>
  questionsById.has(id) && typeof result === 'boolean'));
const allQuestions = bank.questions.map(question => question.id);
const defaultFilters = { exam: 'all', type: 'all', mode: 'ordered' };
const savedSession = saved.session;
const canResume = savedSession?.filters && Array.isArray(savedSession.ids)
  && savedSession.ids.every(id => questionsById.has(id))
  && savedSession.results && typeof savedSession.results === 'object'
  && Object.hasOwn(modeNames, savedSession.filters.mode)
  && Number.isInteger(savedSession.index) && savedSession.index >= 0
  && savedSession.index < Math.max(1, savedSession.ids.length);
let session = canResume ? savedSession : {
  filters: defaultFilters, ids: allQuestions, index: 0, results: {}, finished: false,
};

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ history, session }));
  } catch {
    // Practice remains usable if storage is disabled or full.
  }
}

function normalizeAnswer(text, caseSensitive) {
  const normalized = text.normalize('NFC').trim().replace(/\s+/g, ' ');
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function checkBlanks(question, values) {
  const groups = question.blanks;
  const matches = (value, group) => {
    const normalized = normalizeAnswer(value, group.caseSensitive);
    return group.accepted.some(answer => normalizeAnswer(answer, group.caseSensitive) === normalized);
  };
  if (!question.unordered) return values.map((value, index) => matches(value, groups[index]));

  // Match each entry to a distinct answer group, including when alternatives overlap.
  const assigned = Array(groups.length).fill(-1);
  function assign(input, visited) {
    for (const [index, group] of groups.entries()) {
      if (visited.has(index) || !matches(values[input], group)) continue;
      visited.add(index);
      if (assigned[index] < 0 || assign(assigned[index], visited)) {
        assigned[index] = input;
        return true;
      }
    }
    return false;
  }
  return values.map((_, index) => assign(index, new Set()));
}

function shuffle(ids) {
  for (let index = ids.length - 1; index > 0; index--) {
    const random = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[random]] = [ids[random], ids[index]];
  }
}

function setFilters(filters) {
  for (const key of Object.keys(defaultFilters)) $(key).value = filters[key];
}

function start(filters, focus = true) {
  const ids = bank.questions.filter(question =>
    (filters.exam === 'all' || filters.exam === String(question.exam))
    && (filters.type === 'all' || filters.type === questionType(question))
    && (filters.mode !== 'wrong' || history[question.id] === false),
  ).map(question => question.id);
  if (filters.mode === 'shuffle') shuffle(ids);
  session = { filters, ids, index: 0, results: {}, finished: false };
  setFilters(filters);
  save();
  render(focus);
}

function questionType(question) {
  return Array.isArray(question.answer) ? 'multiple-choice' : question.type;
}

function choices(question) {
  if (question.type === 'true-false') return [['true', 'True', '正确'], ['false', 'False', '错误']];
  return Object.entries(question.options).map(([key, label]) => [key, label, question.optionsZh?.[key]]);
}

function answerKeys(question) {
  return Array.isArray(question.answer) ? question.answer : [String(question.answer)];
}

function questionText(text, lang, className) {
  const line = element('span', undefined, className);
  line.lang = lang;
  for (const [index, part] of text.split(/\[空\s*(\d+)\]/g).entries()) {
    if (index % 2) {
      const marker = element('span', part, 'blank-marker');
      marker.setAttribute('aria-label', '第 ' + part + ' 空');
      marker.lang = 'zh-CN';
      line.append(marker);
    } else {
      line.append(part);
    }
  }
  return line;
}

function renderPrompt(question) {
  prompt.replaceChildren(questionText(question.prompt, 'en'));
  if (question.promptZh) prompt.append(questionText(question.promptZh, 'zh-CN', 'prompt-translation'));
}

function optionText(label, translation) {
  const text = element('span', undefined, 'option-text');
  const english = element('span', label);
  english.lang = 'en';
  text.append(english);
  if (translation) {
    const chinese = element('span', translation, 'option-translation');
    chinese.lang = 'zh-CN';
    text.append(chinese);
  }
  return text;
}

function renderFields(question, result) {
  const fill = question.type === 'fill';
  const group = element('fieldset', undefined, fill ? 'fill-fields' : 'options');
  group.setAttribute('aria-labelledby', 'prompt');
  if (fill) {
    for (const [index, blank] of question.blanks.entries()) {
      const label = element('label', `第 ${index + 1} 空`);
      const input = element('input', undefined, 'fill-input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.maxLength = 300;
      if (result) {
        input.value = result.value[index];
        input.readOnly = true;
        input.classList.add(result.matches[index] ? 'correct' : 'incorrect');
      }
      label.append(input);
      group.append(label);
    }
    const hints = [];
    if (!result) hints.push('填完所有空后，离开输入框或按回车即可判分。');
    if (question.unordered) hints.push('可乱序作答');
    if (question.blanks.some(blank => blank.caseSensitive)) hints.push('按原卷要求区分大小写');
    if (hints.length) group.append(element('p', hints.join(' · '), 'hint'));
  } else {
    const type = questionType(question);
    const multi = type === 'multiple-choice';
    const keys = answerKeys(question);
    const selected = result ? (multi ? result.value : [result.value]) : [];
    if (multi && !result) group.append(element('p', '选好后点击「下一题」查看答案。', 'hint'));
    for (const [value, label, translation] of choices(question)) {
      const option = element('label', undefined, 'option');
      const input = element('input');
      input.type = multi ? 'checkbox' : 'radio';
      input.name = 'answer';
      input.value = value;
      if (result) {
        input.checked = selected.includes(value);
        input.disabled = true;
        if (keys.includes(value)) option.classList.add('correct');
        else if (input.checked) option.classList.add('incorrect');
      }
      const badge = type === 'true-false' ? (value === 'true' ? 'T' : 'F') : value;
      option.append(input, element('b', badge), optionText(label, translation));
      group.append(option);
    }
  }
  answerFields.replaceChildren(group);
}

function renderFeedback(question, result) {
  feedback.className = '';
  feedback.replaceChildren();
  if (!result) return;
  feedback.className = result.correct ? 'good' : 'bad';
  const earned = question.points * result.matches.filter(Boolean).length / result.matches.length;
  feedback.append(element('strong', `${result.correct ? '回答正确' : '还可以再练习'} · ${formatNumber(earned)} / ${question.points} 分`));
  if (question.type === 'fill') {
    for (const [index, blank] of question.blanks.entries()) {
      const line = element('p', `第 ${index + 1} 空参考答案 `);
      const answer = element('span', blank.accepted.join(' / '));
      answer.lang = 'en';
      line.append(answer);
      feedback.append(line);
    }
  } else {
    const keys = answerKeys(question);
    for (const [key, label, translation] of choices(question)) {
      if (!keys.includes(key)) continue;
      const prefix = question.type === 'true-false' ? '标准答案 ' : '标准答案 ' + key + '. ';
      const line = element('p', prefix);
      const english = element('span', label);
      english.lang = 'en';
      line.append(english);
      if (translation) line.append('（' + translation + '）');
      feedback.append(line);
    }
  }
}

function renderStats() {
  const latest = Object.values(history);
  $('attempted').textContent = latest.length;
  $('mastered').textContent = latest.filter(Boolean).length;
  $('mistakes').textContent = latest.filter(result => !result).length;
  const total = session.ids.length;
  const answered = Object.keys(session.results).length;
  position.textContent = session.finished || !total
    ? `本轮已答 ${answered} / ${total}`
    : `第 ${session.index + 1} / ${total} 题 · 已答 ${answered}`;
  $('progress').max = total || 1;
  $('progress').value = answered;
}

function renderNavigation() {
  const scroll = questionGrid.scrollTop;
  const grid = document.createDocumentFragment();
  $('navigation').hidden = session.ids.length === 0;
  session.ids.forEach((id, index) => {
    const question = questionsById.get(id);
    const result = session.results[id];
    const button = element('button', index + 1, result ? result.correct ? 'good' : 'bad' : '');
    button.type = 'button';
    button.dataset.index = index;
    const state = result ? (result.correct ? '已答对' : '已答错') : '未作答';
    button.setAttribute('aria-label', `练习第 ${index + 1} 题，${examsById.get(question.exam)}，原卷第 ${question.number} 题，${state}`);
    if (!session.finished && index === session.index) button.setAttribute('aria-current', 'true');
    grid.append(button);
  });
  questionGrid.replaceChildren(grid);
  questionGrid.scrollTop = scroll;
  const current = questionGrid.querySelector('[aria-current]');
  if (!current) return;
  const gridRect = questionGrid.getBoundingClientRect();
  const currentRect = current.getBoundingClientRect();
  if (currentRect.bottom > gridRect.bottom) questionGrid.scrollTop += currentRect.bottom - gridRect.bottom + 5;
  if (currentRect.top < gridRect.top) questionGrid.scrollTop -= gridRect.top - currentRect.top + 5;
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function summaryButton(text, className, action) {
  const button = element('button', text, `button ${className}`);
  button.type = 'button';
  button.addEventListener('click', action);
  return button;
}

function renderSummary(focus) {
  const total = session.ids.length;
  const heading = element('h2', total ? '本轮练习结果' : '当前没有可练习的题目');
  heading.tabIndex = -1;
  const actions = element('div', undefined, 'summary-actions');
  summaryView.replaceChildren(heading);
  if (total) {
    const results = Object.entries(session.results);
    const correct = results.filter(([, result]) => result.correct).length;
    const points = results.reduce((sum, [id, result]) => {
      const earned = questionsById.get(id).points * result.matches.filter(Boolean).length / result.matches.length;
      return sum + earned;
    }, 0);
    const available = session.ids.reduce((sum, id) => sum + questionsById.get(id).points, 0);
    const remaining = total - results.length;
    summaryView.append(element('p', `答对 ${correct} 题 · 答错 ${results.length - correct} 题 · 未答 ${remaining} 题`));
    summaryView.append(element('p', `本轮得分 ${formatNumber(points)} / ${formatNumber(available)}`));
    if (remaining) {
      const nextUnanswered = session.ids.findIndex(id => !session.results[id]);
      actions.append(summaryButton('继续做未答题', 'primary', () => goTo(nextUnanswered)));
    }
    actions.append(summaryButton('返回题目', 'secondary', () => goTo(session.index)));
    if (session.ids.some(id => history[id] === false)) {
      actions.append(summaryButton('重练错题', 'secondary', () => start({ ...session.filters, mode: 'wrong' })));
    }
  } else {
    const text = session.filters.mode === 'wrong' ? '当前筛选范围内没有错题。' : '请选择其他试卷或题型。';
    summaryView.append(element('p', text));
    actions.append(summaryButton('查看全部题目', 'primary', () => start(defaultFilters)));
  }
  summaryView.append(actions);
  if (focus) heading.focus();
}

function render(focus = false) {
  const mode = modeNames[session.filters.mode];
  const scope = examsById.get(Number(session.filters.exam)) ?? '全部试卷';
  $('session-title').textContent = `${mode} · ${scope}`;
  renderStats();
  renderNavigation();
  const question = questionsById.get(session.ids[session.index]);
  const showSummary = !question || session.finished;
  $('question-view').hidden = showSummary;
  summaryView.hidden = !showSummary;
  if (showSummary) {
    renderSummary(focus);
    return;
  }
  const result = session.results[question.id];
  $('question-meta').replaceChildren(
    element('span', typeNames[questionType(question)]),
    element('span', `${examsById.get(question.exam)} · 原卷第 ${question.number} 题 · ${question.points} 分`),
  );
  renderPrompt(question);
  renderFields(question, result);
  renderFeedback(question, result);
  if (focus) prompt.focus();
}

function goTo(index) {
  if (index < 0 || index >= session.ids.length) return;
  session.index = index;
  session.finished = false;
  save();
  render(true);
}

$('settings').addEventListener('submit', event => {
  event.preventDefault();
  const filters = Object.fromEntries(Object.keys(defaultFilters).map(key => [key, $(key).value]));
  start(filters);
});

function currentQuestion() {
  return questionsById.get(session.ids[session.index]);
}

function gradeAnswer(question, value, matches, focusNext = false) {
  const result = { value, matches, correct: matches.every(Boolean) };
  session.results[question.id] = result;
  history[question.id] = result.correct;
  save();
  renderFields(question, result);
  renderFeedback(question, result);
  renderStats();
  renderNavigation();
  if (focusNext) nextButton.focus();
}

function gradeFill(question, focusNext = false) {
  const values = Array.from(answerFields.querySelectorAll('.fill-input'), input => input.value.trim());
  if (values.some(value => !value)) return false;
  gradeAnswer(question, values, checkBlanks(question, values), focusNext);
  return true;
}

answerFields.addEventListener('change', event => {
  const question = currentQuestion();
  if (!question || session.results[question.id] || event.target.type !== 'radio') return;
  const value = event.target.value;
  gradeAnswer(question, value, [answerKeys(question).includes(value)], true);
});

answerFields.addEventListener('focusout', () => {
  const question = currentQuestion();
  if (question?.type !== 'fill' || session.results[question.id]) return;
  gradeFill(question);
});

answerForm.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || !event.target.matches('.fill-input')) return;
  event.preventDefault();
  const question = currentQuestion();
  if (question && !session.results[question.id]) gradeFill(question, true);
});

nextButton.addEventListener('pointerdown', event => {
  // Keep a click on Next from blurring the final input before the click can grade it.
  if (document.activeElement?.matches('.fill-input:not([readonly])')) event.preventDefault();
});

nextButton.addEventListener('click', () => {
  const question = currentQuestion();
  if (question && !session.results[question.id]) {
    if (questionType(question) === 'multiple-choice') {
      const selected = Array.from(answerFields.querySelectorAll('input:checked'), input => input.value);
      const keys = answerKeys(question);
      gradeAnswer(question, selected, [selected.length === keys.length && selected.every(key => keys.includes(key))]);
      return;
    }
    if (question.type === 'fill' && gradeFill(question, true)) return;
  }
  if (session.index < session.ids.length - 1) {
    goTo(session.index + 1);
  } else {
    session.finished = true;
    save();
    render(true);
  }
});
questionGrid.addEventListener('click', event => {
  const button = event.target.closest('button[data-index]');
  if (button) goTo(Number(button.dataset.index));
});

for (const exam of bank.exams) $('exam').add(new Option(exam.title, exam.id));
const bankTypes = new Set(bank.questions.map(questionType));
if (bankTypes.has('multiple-choice')) $('type').add(new Option(typeNames['multiple-choice'], 'multiple-choice'), 2);
$('bank-summary').textContent = [bank.exams.length + ' 份试卷', bank.questions.length + ' 道题', Array.from(bankTypes, type => typeNames[type]).join('、')].join(' · ');
setFilters(session.filters);
render();
