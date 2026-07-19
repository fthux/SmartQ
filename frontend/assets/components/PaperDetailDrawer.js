import { useSmartQ } from "../stores/context.js";

export const PaperDetailDrawer = {
  name: "PaperDetailDrawer",
  setup: useSmartQ,
  template: `<div v-if="state.selectedPaperId" class="fixed inset-0 z-50 bg-ink/35" role="dialog" aria-modal="true" aria-label="试卷详情抽屉" @click.self="clearSelectedPaper">
          <aside class="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-[0_24px_70px_rgba(15,23,42,0.28)] sm:max-w-[760px] xl:max-w-[860px]">
            <div class="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 px-4 sm:px-6">
              <div class="min-w-0"><div class="text-base font-black">试卷详情</div><div class="mt-0.5 truncate text-xs font-semibold text-slate-500">{{ state.selectedPaperDetail?.name || '正在加载试卷内容' }}</div></div>
              <div class="flex shrink-0 items-center gap-2">
                <button v-if="state.selectedPaperDetail && state.selectedPaperDetail.status !== '已发布'" type="button" title="编辑试卷" class="flex h-9 items-center gap-2 rounded bg-ink px-3 text-xs font-black text-white" @click="editPaper(state.selectedPaperDetail)"><i data-lucide="pencil" class="h-4 w-4"></i><span class="hidden sm:inline">编辑</span></button>
                <button type="button" title="关闭详情" aria-label="关闭详情" class="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-600" @click="clearSelectedPaper"><i data-lucide="x" class="h-4 w-4"></i></button>
              </div>
            </div>

            <div v-if="state.paperDetailLoading" class="flex flex-1 items-center justify-center px-6 text-sm font-bold text-slate-500"><i data-lucide="loader-circle" class="mr-2 h-4 w-4 animate-spin"></i>试卷加载中...</div>
            <div v-else-if="state.selectedPaperDetail" class="min-h-0 flex-1 overflow-y-auto">
              <div class="sticky top-0 z-10 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_100px_100px_100px] sm:items-center">
                  <div class="col-span-2 min-w-0 sm:col-span-1"><div class="truncate text-lg font-black">{{ state.selectedPaperDetail.name }}</div><div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ state.selectedPaperDetail.id }}</div></div>
                  <div><div class="text-base font-black">{{ state.selectedPaperDetail.questionCount || 0 }}</div><div class="text-[11px] font-bold text-slate-500">题目</div></div>
                  <div><div class="text-base font-black">{{ state.selectedPaperDetail.score || 0 }}</div><div class="text-[11px] font-bold text-slate-500">总分</div></div>
                  <div><span class="inline-flex rounded px-2 py-1 text-xs font-black" :class="paperStatusClass(state.selectedPaperDetail.status)">{{ displayPaperStatus(state.selectedPaperDetail.status) }}</span></div>
                </div>
                <div class="mt-4 flex items-center justify-between gap-3">
                  <div class="text-sm font-black">题目内容</div>
                  <div class="grid grid-cols-2 rounded border border-slate-200 bg-slate-50 p-1" aria-label="题目详情模式">
                    <button type="button" class="h-7 px-3 text-xs font-black" :class="state.paperDetailMode === 'compact' ? 'rounded bg-white text-ink shadow-sm' : 'text-slate-500'" @click="state.paperDetailMode = 'compact'">紧凑</button>
                    <button type="button" class="h-7 px-3 text-xs font-black" :class="state.paperDetailMode === 'full' ? 'rounded bg-white text-ink shadow-sm' : 'text-slate-500'" @click="state.paperDetailMode = 'full'">完整</button>
                  </div>
                </div>
              </div>

              <div class="divide-y divide-slate-100 px-4 sm:px-6">
                <div v-for="(question, index) in state.selectedPaperDetail.questions || []" :key="question.id" class="py-4">
                  <div class="grid grid-cols-[36px_minmax(0,1fr)_52px] items-start gap-3 sm:grid-cols-[40px_68px_minmax(0,1fr)_56px]">
                    <div class="pt-0.5 text-sm font-black text-slate-400">{{ String(index + 1).padStart(2, '0') }}</div>
                    <div class="hidden sm:block"><span class="rounded px-2 py-1 text-xs font-bold" :class="typeClass[question.type] || 'bg-slate-50 text-slate-600'">{{ question.type }}</span></div>
                    <div class="min-w-0">
                      <div class="mb-2 sm:hidden"><span class="rounded px-2 py-1 text-xs font-bold" :class="typeClass[question.type] || 'bg-slate-50 text-slate-600'">{{ question.type }}</span></div>
                      <div class="text-sm font-semibold leading-6" :class="state.paperDetailMode === 'compact' ? 'max-h-12 overflow-hidden' : ''">{{ question.stem }}</div>
                      <div v-if="state.paperDetailMode === 'full' && ['单选','多选','判断'].includes(question.type)" class="mt-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2">
                        <div v-for="(option, optionIndex) in displayQuestionOptions(question)" :key="optionIndex" class="rounded border border-slate-100 bg-slate-50 px-3 py-2">{{ String.fromCharCode(65 + optionIndex) }}. {{ option }}</div>
                      </div>
                      <div class="mt-2 whitespace-pre-line text-xs font-semibold leading-5 text-slate-500">答案：{{ Array.isArray(question.answer) ? question.answer.join('、') : question.answer }}</div>
                    </div>
                    <div class="text-right text-sm font-black text-slate-600">{{ question.score }} 分</div>
                  </div>
                </div>
                <div v-if="!(state.selectedPaperDetail.questions || []).length" class="py-16 text-center text-sm font-bold text-slate-500">该试卷暂无题目内容</div>
              </div>
            </div>
          </aside>
        </div>`,
};
