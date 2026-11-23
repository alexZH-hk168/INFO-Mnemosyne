"""LongMemEval 官方判分提示与判定规则。

来源：https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py
（该文件最后一次修改的提交为 d6dc8b50a2d9ac0c99485ea28fa5755c62414c34，2024-11-24；仓库 HEAD 9e0b455，2026-05-11 查得）
下面五段提示模板逐字照抄官方，判定规则同官方：判分模型回复里出现 'yes'（不区分大小写）即判对；
拒答题按 question_id 中含 '_abs' 识别（官方写法）；调用参数 temperature=0、max_tokens=10、n=1。
官方 model_zoo：gpt-4o → gpt-4o-2024-08-06，gpt-4o-mini → gpt-4o-mini-2024-07-18。

原文许可（MIT，按其要求保留版权与许可声明）：

MIT License

Copyright (c) 2024 Di Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from __future__ import annotations

JUDGE_MODELS = {
    "gpt-4o": "gpt-4o-2024-08-06",
    "gpt-4o-mini": "gpt-4o-mini-2024-07-18",
}
JUDGE_PARAMS = {"temperature": 0, "max_tokens": 10, "n": 1}

_T_DEFAULT = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
_T_TEMPORAL = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. \n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
_T_UPDATE = "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
_T_PREFERENCE = "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only."
_T_ABSTENTION = "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only."


def get_anscheck_prompt(task: str, question: str, answer, response: str, abstention: bool = False) -> str:
    """与官方 get_anscheck_prompt 同名同逻辑（answer 用 str.format 原样代入，整数答案也一样）。"""
    if not abstention:
        if task in ("single-session-user", "single-session-assistant", "multi-session"):
            return _T_DEFAULT.format(question, answer, response)
        if task == "temporal-reasoning":
            return _T_TEMPORAL.format(question, answer, response)
        if task == "knowledge-update":
            return _T_UPDATE.format(question, answer, response)
        if task == "single-session-preference":
            return _T_PREFERENCE.format(question, answer, response)
        raise NotImplementedError(task)
    return _T_ABSTENTION.format(question, answer, response)


def is_abstention_official(question_id: str) -> bool:
    """官方 evaluate_qa.py 的写法：`'_abs' in question_id`。"""
    return "_abs" in str(question_id)


def label_from_response(text: str) -> bool:
    """官方：`label = 'yes' in eval_response.lower()`（先 strip）。"""
    return "yes" in (text or "").strip().lower()
