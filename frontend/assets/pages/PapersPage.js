import { useSmartQ } from "../stores/context.js";

export const PapersPage = {
  name: "PapersPage",
  setup: useSmartQ,
  template: `<section v-if="state.route === 'papers'" class="mt-6 space-y-5">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 class="text-3xl font-black">已出卷子管理</h1>
              <div class="mt-1 text-sm font-semibold text-slate-500">集中管理草稿、已发布和历史试卷</div>
            </div>
            <button type="button" class="flex h-10 items-center justify-center gap-2 rounded bg-ink px-4 text-sm font-black text-white shadow-sm" @click="go('authoring')">
              <i data-lucide="plus" class="h-4 w-4"></i>
              新建试卷
            </button>
          </div>

          <div class="grid grid-cols-2 divide-x divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm sm:grid-cols-4 sm:divide-y-0">
            <div class="px-4 py-3 sm:px-5"><div class="text-xl font-black">{{ paperRows.length }}</div><div class="mt-0.5 text-xs font-bold text-slate-500">历史试卷</div></div>
            <div class="px-4 py-3 sm:px-5"><div class="text-xl font-black text-leaf">{{ papers.filter((item) => item.status === '已发布').length }}</div><div class="mt-0.5 text-xs font-bold text-slate-500">已发布</div></div>
            <div class="px-4 py-3 sm:px-5"><div class="text-xl font-black text-iris">{{ papers.filter((item) => ['草稿','未发布','已保存','已组卷'].includes(item.status)).length }}</div><div class="mt-0.5 text-xs font-bold text-slate-500">草稿</div></div>
            <div class="px-4 py-3 sm:px-5"><div class="text-xl font-black text-ocean">{{ paperRows.reduce((sum, item) => sum + Number(item.questionCount || 0), 0) }}</div><div class="mt-0.5 text-xs font-bold text-slate-500">累计题数</div></div>
          </div>

          <div class="rounded-lg border border-slate-200 bg-white shadow-soft">
            <div class="flex flex-col gap-3 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
              <label class="relative block w-full xl:max-w-md">
                <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"></i>
                <input v-model="state.paperSearch" class="h-10 w-full rounded border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-ocean focus:ring-2 focus:ring-cyan-50" placeholder="搜索试卷名称或编号" @input="resetPaperPage" />
              </label>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div class="grid grid-cols-3 rounded border border-slate-200 bg-slate-50 p-1" aria-label="试卷状态筛选">
                  <button v-for="option in [{ value: 'all', label: '全部' }, { value: 'unpublished', label: '草稿' }, { value: 'published', label: '已发布' }]" :key="option.value" type="button" class="h-8 px-3 text-xs font-black transition" :class="state.paperStatusFilter === option.value ? 'rounded bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-ink'" @click="state.paperStatusFilter = option.value; resetPaperPage()">{{ option.label }}</button>
                </div>
                <label class="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <span class="shrink-0">排序</span>
                  <select v-model="state.paperSort" class="h-10 rounded border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-ocean" @change="resetPaperPage">
                    <option value="latest">最近更新</option>
                    <option value="oldest">最早创建</option>
                    <option value="name">按名称</option>
                  </select>
                </label>
              </div>
            </div>

            <div v-if="pagedPaperRows.length" class="hidden overflow-x-auto md:block">
              <div class="min-w-[880px]">
                <div class="grid grid-cols-[minmax(260px,1.8fr)_120px_92px_92px_164px_112px] items-center border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-black text-slate-500">
                  <div>试卷名称</div><div>状态</div><div>题数</div><div>总分</div><div>更新时间</div><div class="text-right">操作</div>
                </div>
                <div v-for="item in pagedPaperRows" :key="item.id" class="grid min-h-16 cursor-pointer grid-cols-[minmax(260px,1.8fr)_120px_92px_92px_164px_112px] items-center border-b border-slate-100 px-5 text-sm transition last:border-b-0 hover:bg-slate-50" @click="selectPaper(item.id)">
                  <div class="min-w-0 pr-5"><div class="truncate font-black text-ink">{{ item.name }}</div><div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ item.id }}</div></div>
                  <div><span class="inline-flex rounded px-2 py-1 text-xs font-black" :class="paperStatusClass(item.status)">{{ displayPaperStatus(item.status) }}</span></div>
                  <div class="font-bold text-slate-600">{{ item.questionCount || 0 }} 题</div>
                  <div class="font-bold text-slate-600">{{ item.score || 0 }} 分</div>
                  <div class="text-xs font-semibold text-slate-500">{{ formatDateTime(item.publishedAt || item.createdAt) }}</div>
                  <div class="relative flex justify-end gap-1" data-paper-action-menu>
                    <button type="button" :title="item.status === '已发布' ? '查看详情' : '编辑试卷'" :aria-label="item.status === '已发布' ? '查看详情' : '编辑试卷'" class="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:border-ocean hover:text-ocean" @click.stop="item.status === '已发布' ? selectPaper(item.id) : editPaper(item)">
                      <i :data-lucide="item.status === '已发布' ? 'eye' : 'pencil'" class="h-4 w-4"></i>
                    </button>
                    <button type="button" title="更多操作" aria-label="更多操作" class="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:text-ink" @click.stop="togglePaperActionMenu(item.id)"><i data-lucide="ellipsis" class="h-4 w-4"></i></button>
                    <div v-if="state.paperActionMenuId === item.id" class="absolute right-0 top-10 z-30 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-[0_14px_36px_rgba(15,23,42,0.16)]" @click.stop>
                      <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50" @click="selectPaper(item.id)"><i data-lucide="eye" class="h-4 w-4"></i>查看详情</button>
                      <button v-if="item.status !== '已发布'" type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50" @click="editPaper(item)"><i data-lucide="pencil" class="h-4 w-4"></i>编辑试卷</button>
                      <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold text-coral hover:bg-rose-50" @click="askDeletePaper(item)"><i data-lucide="trash-2" class="h-4 w-4"></i>删除试卷</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="pagedPaperRows.length" class="divide-y divide-slate-100 md:hidden">
              <div v-for="item in pagedPaperRows" :key="item.id" class="p-4" @click="selectPaper(item.id)">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0"><div class="truncate text-sm font-black">{{ item.name }}</div><div class="mt-1 truncate text-xs font-semibold text-slate-400">{{ item.id }}</div></div>
                  <span class="shrink-0 rounded px-2 py-1 text-xs font-black" :class="paperStatusClass(item.status)">{{ displayPaperStatus(item.status) }}</span>
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-bold text-slate-500">
                  <span>{{ item.questionCount || 0 }} 题</span><span>{{ item.score || 0 }} 分</span><span>{{ formatDateTime(item.publishedAt || item.createdAt) }}</span>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <button type="button" class="flex h-9 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-black text-slate-700" @click.stop="selectPaper(item.id)"><i data-lucide="eye" class="h-4 w-4"></i>查看</button>
                  <button v-if="item.status !== '已发布'" type="button" class="flex h-9 items-center gap-2 rounded border border-slate-200 bg-white px-3 text-xs font-black text-slate-700" @click.stop="editPaper(item)"><i data-lucide="pencil" class="h-4 w-4"></i>编辑</button>
                  <button type="button" title="删除试卷" aria-label="删除试卷" class="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:border-rose-200 hover:text-coral" @click.stop="askDeletePaper(item)"><i data-lucide="trash-2" class="h-4 w-4"></i></button>
                </div>
              </div>
            </div>

            <div v-if="!paperRows.length" class="px-4 py-16 text-center">
              <i data-lucide="files" class="mx-auto h-8 w-8 text-slate-300"></i><div class="mt-3 text-sm font-black text-slate-600">暂无已出卷子</div><div class="mt-1 text-xs font-semibold text-slate-500">完成出题制卷并保存后，试卷会显示在这里。</div>
            </div>
            <div v-else-if="!filteredPaperRows.length" class="px-4 py-16 text-center">
              <i data-lucide="search-x" class="mx-auto h-8 w-8 text-slate-300"></i><div class="mt-3 text-sm font-black text-slate-600">暂无匹配试卷</div><div class="mt-1 text-xs font-semibold text-slate-500">请调整关键词或状态筛选。</div>
            </div>

            <div v-if="paperRows.length" class="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-xs font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div>显示 {{ paperPageStart }}–{{ paperPageEnd }} 条，共 {{ filteredPaperRows.length }} 份试卷</div>
              <div class="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                <label class="flex items-center gap-2"><span>每页</span><select v-model.number="state.paperPageSize" class="h-8 rounded border border-slate-200 bg-white px-2 text-xs font-black text-slate-700" @change="resetPaperPage"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select></label>
                <span class="min-w-16 text-center text-sm font-black text-ink">{{ currentPaperPage }} / {{ paperTotalPages }}</span>
                <div class="flex gap-1">
                  <button type="button" title="上一页" aria-label="上一页" class="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="currentPaperPage <= 1" @click="changePaperPage(-1)"><i data-lucide="chevron-left" class="h-4 w-4"></i></button>
                  <button type="button" title="下一页" aria-label="下一页" class="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 disabled:cursor-not-allowed disabled:opacity-40" :disabled="currentPaperPage >= paperTotalPages" @click="changePaperPage(1)"><i data-lucide="chevron-right" class="h-4 w-4"></i></button>
                </div>
              </div>
            </div>
          </div>
        </section>`,
};
