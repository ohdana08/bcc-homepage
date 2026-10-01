// The SQL function touches only the project-instruction tables. It never invokes
// the site's existing account-deletion cleanup path.
export async function purgeProjectInstructions(db) {
  const { data, error } = await db.rpc('purge_project_instructions');
  if (error) throw new Error('업무지시서 보관 기간 정리를 완료하지 못했습니다.');
  return { deleted: Number(data || 0) };
}
