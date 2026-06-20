-- Increase ai_content limit to 4000 (reasoning JSON can exceed 2000 chars with many key points)
-- Increase correct_answer limit to 2000 (reasoning corrections stored as JSON array)

alter table public.ai_error_cases
  drop constraint if exists ai_error_cases_ai_content_check;
alter table public.ai_error_cases
  add constraint ai_error_cases_ai_content_check
    check (char_length(ai_content) between 1 and 4000);

alter table public.ai_error_cases
  drop constraint if exists ai_error_cases_correct_answer_check;
alter table public.ai_error_cases
  add constraint ai_error_cases_correct_answer_check
    check (char_length(correct_answer) between 1 and 2000);

notify pgrst, 'reload schema';
