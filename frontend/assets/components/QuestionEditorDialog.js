import { useSmartQ } from "../stores/context.js";

export const QuestionEditorDialog = {
  name: "QuestionEditorDialog",
  setup: useSmartQ,
  template: `
    <div v-if="state.editingQuestion && state.questionEditForm" class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
      <form novalidate class="w-full max-w-3xl rounded-lg bg-white p-5 shadow-soft" @submit.prevent="saveQuestionEdit">
        <div class="flex items-start justify-between">
          <div>
            <div class="text-lg font-black">编辑题目</div>
            <div class="mt-1 text-xs font-semibold text-slate-500">保存后题目会回到待确认状态</div>
          </div>
          <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700" @click="closeQuestionEditor">关闭</button>
        </div>
        <div class="mt-5 grid grid-cols-[120px_120px_1fr] gap-3">
          <label class="text-xs font-bold text-slate-600">题型<input v-model="state.questionEditForm.type" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
          <label class="text-xs font-bold text-slate-600">分值<input v-model.number="state.questionEditForm.score" type="number" min="1" max="200" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
          <label class="text-xs font-bold text-slate-600">难度<input v-model="state.questionEditForm.difficulty" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
        </div>
        <label class="mt-4 block text-xs font-bold text-slate-600">题干<textarea v-model="state.questionEditForm.stem" class="mt-2 min-h-24 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold leading-6" :class="state.questionEditErrors.stem ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'"></textarea><div :class="fieldErrorClass(state.questionEditErrors.stem)">{{ state.questionEditErrors.stem || '' }}</div></label>
        <div v-if="['单选','多选'].includes(state.questionEditForm.type)" class="mt-4 grid grid-cols-2 gap-3">
          <label v-for="(letter, index) in ['A','B','C','D']" :key="letter" class="text-xs font-bold text-slate-600">{{ letter }}<input v-model="state.questionEditForm['option' + letter]" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors['option' + letter] ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors['option' + letter])">{{ state.questionEditErrors['option' + letter] || '' }}</div></label>
        </div>
        <div v-else-if="state.questionEditForm.type === '判断'" class="mt-4 grid grid-cols-2 gap-3">
          <label class="text-xs font-bold text-slate-600">A<input value="正确" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
          <label class="text-xs font-bold text-slate-600">B<input value="错误" disabled class="mt-2 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500" /></label>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-3">
          <label v-if="state.questionEditForm.type === '单选'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>A</option><option>B</option><option>C</option><option>D</option></select></label>
          <label v-else-if="state.questionEditForm.type === '判断'" class="text-xs font-bold text-slate-600">答案<select v-model="state.questionEditForm.answerSingle" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold"><option>正确</option><option>错误</option></select></label>
          <div v-else-if="state.questionEditForm.type === '多选'" class="text-xs font-bold text-slate-600">
            <div>答案</div>
            <div class="mt-2 flex h-[38px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3">
              <label v-for="letter in ['A','B','C','D']" :key="letter" class="flex items-center gap-1 text-sm font-black text-slate-700"><input v-model="state.questionEditForm.answerMultiple" type="checkbox" :value="letter" />{{ letter }}</label>
            </div>
            <div :class="fieldErrorClass(state.questionEditErrors.answerMultiple)">{{ state.questionEditErrors.answerMultiple || '' }}</div>
          </div>
          <label v-else class="text-xs font-bold text-slate-600">答案<input v-model="state.questionEditForm.answerText" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold" :class="state.questionEditErrors.answerText ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /><div :class="fieldErrorClass(state.questionEditErrors.answerText)">{{ state.questionEditErrors.answerText || '' }}</div></label>
          <label class="text-xs font-bold text-slate-600">解析<input v-model="state.questionEditForm.explanation" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" /></label>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="closeQuestionEditor">取消</button>
          <button type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white">保存修改</button>
        </div>
      </form>
    </div>
  `,
};
