import { NextResponse } from 'next/server';
import { exportAllDigests } from '@/lib/daily-digest/obsidian-export';

/** POST /api/daily/export → 把库里已有的全部 digest 回填成 Obsidian 表格
 *  （幂等，可反复跑）。日常每天生成时会自动写，这个接口用于一次性补存量。 */
export async function POST() {
  try {
    return NextResponse.json(exportAllDigests());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
