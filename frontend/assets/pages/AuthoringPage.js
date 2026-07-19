import { useSmartQ } from "../stores/context.js";

export const AuthoringPage = {
  name: "AuthoringPage",
  setup: useSmartQ,
  template: `<section v-if="state.route === 'authoring'" class="mt-6 space-y-5">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-sm font-bold text-ocean">{{ state.dashboard.exam.title }}</div>
                <h1 class="mt-2 text-3xl font-black tracking-normal">出题页面</h1>
                <div class="mt-2 text-sm font-semibold text-slate-500">完成命题配置、质量复检、人工审核、保存试卷和发布</div>
                <div v-if="state.authoringPaperId" class="mt-2 inline-flex rounded bg-cyan-50 px-2 py-1 text-xs font-black text-ocean">正在编辑试卷：{{ paper.name || state.authoringPaperId }}</div>
                <div v-else class="mt-2 inline-flex rounded bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">新建试卷</div>
              </div>
              <div class="rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-ocean">当前：{{ workflowSteps.find((item) => item.key === state.activeWorkflowStep)?.title || '命题配置' }}</div>
            </div>
            <div class="mt-5 grid grid-cols-5 gap-3">
              <button
                v-for="step in workflowSteps"
                :key="step.key"
                class="min-h-[132px] rounded-lg border p-3 text-left"
                :class="[
                  step.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : step.status === 'active' ? 'border-ocean bg-white text-ocean' : 'border-slate-200 bg-white text-slate-500',
                  state.activeWorkflowStep === step.key ? 'ring-2 ring-ocean ring-offset-2' : '',
                  step.clickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                ]"
                :disabled="!step.clickable"
                @click="setWorkflowStep(step.key)"
              >
                <div class="flex items-center justify-between">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black" :class="step.status === 'done' ? 'bg-leaf text-white' : step.status === 'active' ? 'bg-ocean text-white' : 'bg-slate-100 text-slate-500'">{{ step.status === 'done' ? '✓' : workflowSteps.indexOf(step) + 1 }}</span>
                  <span class="rounded bg-white/80 px-2 py-1 text-[11px] font-black">{{ workflowStatusText(step.status) }}</span>
                </div>
                <div class="mt-3 text-sm font-black text-ink">{{ step.title }}</div>
                <div class="mt-1 min-h-8 text-xs font-semibold leading-4 text-slate-500">{{ step.meta }}</div>
                <div class="mt-3 text-xs font-black">{{ step.action }}</div>
              </button>
            </div>
          </div>

          <form v-if="visibleWorkflowStep === 'config'" novalidate class="rounded-lg border border-ocean/30 bg-cyan-50/70 p-5 shadow-soft" @submit.prevent="generateDraft">
            <div class="flex items-center justify-between">
              <div>
                <div class="flex items-center gap-2 text-sm font-black text-ocean"><i data-lucide="sparkles" class="h-4 w-4"></i>AI 命题任务</div>
                <div class="mt-1 text-xs font-semibold text-slate-500">{{ formLocked ? '试卷已生成，命题参数已锁定；如需修改，请点击重新生成' : state.regeneratingDraft ? '正在重新生成模式，可调整参数并生成新的试卷' : '出题者填写命题参数后生成试卷' }}</div>
              </div>
              <div class="flex items-center gap-2">
                <button v-if="state.generating" type="button" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white opacity-70" disabled>生成中</button>
                <button v-else-if="formLocked" type="button" class="rounded-lg border border-ocean/30 bg-white px-4 py-2 text-sm font-bold text-ocean" @click="regenerate">重新生成</button>
                <button v-else type="submit" class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white">生成试卷</button>
              </div>
            </div>
            <div v-if="state.generating || state.generationStage" class="mt-4 rounded-lg border border-ocean/20 bg-white p-4">
              <div class="flex items-center justify-between text-sm">
                <div class="flex items-center gap-2 font-black text-ink">
                  <span class="flex h-7 w-7 items-center justify-center rounded-full" :class="state.generationError ? 'bg-rose-50 text-coral' : state.generationProgress === 100 ? 'bg-emerald-50 text-leaf' : 'bg-cyan-50 text-ocean'">
                    <i :data-lucide="state.generating ? 'loader-circle' : state.generationError ? 'circle-alert' : state.generationProgress === 100 ? 'check' : 'loader-circle'" class="h-4 w-4" :class="state.generating ? 'animate-spin' : ''"></i>
                  </span>
                  {{ state.generationStage || '等待生成' }}
                </div>
                <div class="font-black tabular-nums" :class="state.generationError ? 'text-coral' : 'text-ocean'">{{ state.generationProgress }}%</div>
              </div>
              <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-2.5 rounded-full transition-all duration-500 ease-out"
                  :class="state.generationError ? 'bg-coral' : 'bg-gradient-to-r from-ocean via-leaf to-iris'"
                  :style="{ width: state.generationProgress + '%' }"
                ></div>
              </div>
              <div class="mt-3 grid grid-cols-4 gap-2 text-[11px] font-black text-slate-400">
                <div :class="state.generationProgress >= 8 ? 'text-ocean' : ''">参数</div>
                <div :class="state.generationProgress >= 24 ? 'text-ocean' : ''">连接</div>
                <div :class="state.generationProgress >= 50 ? 'text-ocean' : ''">生成</div>
                <div :class="state.generationProgress >= 76 ? 'text-ocean' : ''">校验</div>
              </div>
              <div v-if="state.generationError" class="mt-3 rounded bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-coral">
                {{ state.generationError }}
              </div>
            </div>
            <fieldset :disabled="formLocked" class="mt-4">
              <div class="rounded-lg border border-slate-200 bg-white p-4">
                <div class="text-sm font-black text-ink">出题条件</div>
                <div class="mt-3 grid grid-cols-[1fr_1.1fr_120px] gap-3">
                  <label class="text-xs font-bold text-slate-600">考卷名称<input v-model="state.spec.paperName" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.paperName ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入考卷名称" /><div :class="fieldErrorClass(state.specFormErrors.paperName)">{{ state.specFormErrors.paperName || '' }}</div></label>
                  <label class="text-xs font-bold text-slate-600">出题方向<input v-model="state.spec.direction" class="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100 disabled:text-slate-500" :class="state.specFormErrors.direction ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" placeholder="请输入出题方向" /><div :class="fieldErrorClass(state.specFormErrors.direction)">{{ state.specFormErrors.direction || '' }}</div></label>
                  <label class="text-xs font-bold text-slate-600">难度<select v-model="state.spec.difficulty" class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:bg-slate-100"><option>中</option><option>易</option><option>难</option><option>混合</option></select></label>
                </div>
                <div class="mt-3 grid grid-cols-[1fr_1fr] gap-3">
                  <label class="text-xs font-bold text-slate-600">知识点范围<textarea v-model="state.spec.knowledge" class="mt-2 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 disabled:bg-slate-100" placeholder="请输入知识点范围，用逗号分隔"></textarea></label>
                  <label class="text-xs font-bold text-slate-600">补充要求<textarea v-model="state.spec.requirements" class="mt-2 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-6 disabled:bg-slate-100" placeholder="请输入补充要求"></textarea></label>
                </div>
              </div>
              <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-black text-ink">题量与分值</div>
                    <div :class="fieldErrorClass(state.specFormErrors.questionCount)">{{ state.specFormErrors.questionCount || '' }}</div>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-right">
                    <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-[11px] font-bold text-slate-500">题目数量</div><div class="mt-1 text-lg font-black text-ink">{{ totalQuestionCount }} 题</div></div>
                    <div class="rounded-lg bg-slate-50 px-3 py-2"><div class="text-[11px] font-bold text-slate-500">试卷总分</div><div class="mt-1 text-lg font-black text-ink">{{ computedSpecTotalScore }} 分</div></div>
                  </div>
                </div>
                <div class="mt-3 grid grid-cols-6 gap-2">
                  <div v-for="item in paperTypeConfig" :key="item.type" class="rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <div class="text-xs font-black text-slate-600">{{ item.type }}题</div>
                    <label class="mt-2 block text-[11px] font-bold text-slate-500">数量<input v-model.number="state.spec[item.countKey]" type="number" min="0" max="50" class="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold disabled:bg-slate-100" /></label>
                    <label class="mt-2 block text-[11px] font-bold text-slate-500">每题分<input v-model.number="state.spec[item.scoreKey]" type="number" min="1" max="200" class="mt-1 w-full rounded border bg-white px-2 py-1.5 text-sm font-semibold disabled:bg-slate-100" :class="state.specFormErrors[item.scoreKey] ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'" /></label>
                    <div :class="fieldErrorClass(state.specFormErrors[item.scoreKey])">{{ state.specFormErrors[item.scoreKey] || '' }}</div>
                  </div>
                </div>
              </div>
            </fieldset>
            <div v-if="state.generatedDraft?.questions?.length" class="mt-4 rounded-lg border border-ocean/20 bg-white p-4">
              <div class="flex items-center justify-between">
                <div>
                  <div class="text-sm font-black text-ink">生成试卷预览</div>
                  <div class="mt-1 text-xs font-semibold text-slate-500">{{ state.generatedDraft.spec?.paperName }} · {{ state.generatedDraft.questions.length }} 题 · {{ state.generatedDraft.spec?.totalScore }} 分</div>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700" :disabled="state.saving" @click="discardDraft">丢弃</button>
                  <button type="button" class="rounded-lg bg-ocean px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60" :disabled="state.saving" @click="saveDraft">{{ state.saving ? '处理中' : '进入质量复检' }}</button>
                </div>
              </div>
              <div class="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                <div v-for="(item, index) in state.generatedDraft.questions.slice(0, 12)" :key="item.id" class="grid grid-cols-[42px_64px_1fr_54px] items-center gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <div class="font-black text-slate-500">{{ String(index + 1).padStart(2, '0') }}</div>
                  <div><span class="rounded px-2 py-1 font-bold" :class="typeClass[item.type] || 'bg-white text-slate-600'">{{ item.type }}</span></div>
                  <div class="truncate font-semibold text-ink">{{ item.stem }}</div>
                  <div class="text-right font-black text-slate-600">{{ item.score }} 分</div>
                </div>
              </div>
            </div>
          </form>

          <section v-if="visibleWorkflowStep === 'quality'" class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <div><h2 class="text-lg font-black">AI 质量控制</h2><div class="mt-1 text-xs font-semibold text-slate-500">结构校验、答案一致性、重复题和人工确认</div></div>
              <div class="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">稳定性 {{ authoringQuality.stabilityScore || 0 }}</div>
            </div>
            <div v-if="authoringQuestions.length && !(authoringQuality.failures || []).length" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">质量复检通过，系统将进入人工审核。</div>
            <div class="mt-5 grid grid-cols-4 gap-3">
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">Schema 通过率</div><div class="mt-2 text-2xl font-black text-ocean">{{ authoringQuality.schemaPassRate || 0 }}%</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">答案一致性</div><div class="mt-2 text-2xl font-black text-leaf">{{ authoringQuality.answerConsistency || 0 }}%</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">重复题过滤</div><div class="mt-2 text-2xl font-black text-iris">{{ authoringQuality.duplicateFiltered || 0 }}</div></div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4"><div class="text-sm font-bold">人工待确认</div><div class="mt-2 text-2xl font-black text-honey">{{ authoringQuality.pendingReview || 0 }}</div></div>
            </div>
            <div class="mt-5 flex gap-2">
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="qualityCheck">质量复检</button>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="repairQuality">自动修复</button>
            </div>
          </section>

          <section v-if="visibleWorkflowStep === 'review'" class="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h2 class="text-lg font-black">题目列表</h2><div class="mt-1 text-xs font-semibold text-slate-500">一页展示 · {{ authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0) }} 分 · {{ authoringQuestions.length }} 题</div></div>
            </div>
            <div class="grid grid-cols-[56px_96px_1fr_82px_84px_108px_148px] border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-black text-slate-500">
              <div>序号</div><div>题型</div><div>题干</div><div>难度</div><div>分值</div><div>质量</div><div>操作</div>
            </div>
            <div class="divide-y divide-slate-100 px-5">
              <div v-for="(item, index) in authoringQuestions" :key="item.id" class="grid grid-cols-[56px_96px_1fr_82px_84px_108px_148px] items-center py-3 text-sm">
                <div class="font-black">{{ String(index + 1).padStart(2, '0') }}</div>
                <div><span class="rounded px-2 py-1 text-xs font-bold" :class="typeClass[item.type] || 'bg-slate-50 text-slate-600'">{{ item.type }}</span></div>
                <div class="truncate pr-6 font-semibold">{{ item.stem }}</div>
                <div class="font-bold text-slate-600">{{ item.difficulty }}</div>
                <div class="font-bold">{{ item.score }}</div>
                <div class="font-black" :class="item.quality >= 90 ? 'text-emerald-600' : 'text-amber-600'">{{ item.quality }}</div>
                <div class="flex items-center gap-2">
                  <button class="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700" @click="openQuestionEditor(item)">编辑</button>
                  <button class="rounded px-2 py-1 text-xs font-bold" :class="item.status === '已校验' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'" @click="reviewQuestion(item, item.status !== '已校验')">{{ item.status === '已校验' ? '取消审核' : '审核' }}</button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="visibleWorkflowStep === 'save' || visibleWorkflowStep === 'publish'" class="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-black">试卷结构 · {{ displayPaperStatus(paper.status) }}</h2>
              <i data-lucide="file-check-2" class="h-5 w-5 text-iris"></i>
            </div>
            <div class="mt-5 grid grid-cols-3 gap-3">
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-ocean">{{ paper.score || authoringQuestions.reduce((sum, item) => sum + Number(item.score || 0), 0) }}</div><div class="text-xs font-bold text-slate-500">试卷总分</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-iris">{{ paper.questionCount || authoringQuestions.length }}</div><div class="text-xs font-bold text-slate-500">已选题目</div></div>
              <div class="rounded-lg bg-slate-50 p-4"><div class="text-2xl font-black text-leaf">{{ authoringPendingReviewCount }}</div><div class="text-xs font-bold text-slate-500">待审核</div></div>
            </div>
            <div class="mt-5 flex gap-2">
              <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" @click="savePaper">保存试卷</button>
              <button class="rounded-lg bg-ink px-4 py-2 text-sm font-bold text-white" @click="publishPaper">发布试卷</button>
            </div>
          </section>
        </section>`,
};
