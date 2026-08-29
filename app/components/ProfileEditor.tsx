'use client';

import { FormEvent, useState } from 'react';
import { FileNameInput, Field, FormSection, StatusMessage } from './form-controls';
import { Profile } from '../lib/payroll';

type ProfileTab = 'basic' | 'documents' | 'payment' | 'password';

export function ProfileEditor({
  profile,
  firstTime = false,
  onSave,
  onResetPassword,
  onUpload,
}: {
  profile: Profile;
  firstTime?: boolean;
  onSave: (profile: Profile) => Promise<string | null>;
  onResetPassword: (oldPassword: string, newPassword: string) => Promise<string | null>;
  onUpload?: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState(profile);
  const [tab, setTab] = useState<ProfileTab>('basic');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>('success');
  const [busy, setBusy] = useState(false);

  const setField = <K extends keyof Profile>(field: K, value: Profile[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.lastNameCn.trim() || !draft.firstNameCn.trim()) {
      setMessageTone('error');
      setMessage('中文姓和中文名为必填项。');
      setTab('basic');
      return;
    }
    if (!draft.address.trim()) {
      setMessageTone('error');
      setMessage('现住址为必填项。');
      setTab('basic');
      return;
    }
    if (!draft.tel.trim()) {
      setMessageTone('error');
      setMessage('联系方式为必填项，可分多行填写。');
      setTab('basic');
      return;
    }

    if (!firstTime && tab === 'basic' && !draft.birthday) {
      setMessageTone('error');
      setMessage('请填写生日。');
      return;
    }

    if (!firstTime && tab === 'documents') {
      if (!draft.idType || !draft.dependents) {
        setMessageTone('error');
        setMessage('请填写证件类型与抚养信息。');
        return;
      }
      const expectedIdFiles = draft.idType === 'passport' ? 1 : 2;
      if (draft.idFileNames.length !== expectedIdFiles) {
        setMessageTone('error');
        setMessage(`身份证件需要上传 ${expectedIdFiles} 个文件。`);
        return;
      }
    }

    if (!firstTime && tab === 'payment' && (
      !draft.bankType || !draft.bankName || !draft.bankAccountNumber || !draft.bankAccountHolder
    )) {
      setMessageTone('error');
      setMessage('请补全工资收款方式、账户名称、账号和账户姓名。');
      return;
    }

    setBusy(true);
    const error = await onSave(draft);
    setBusy(false);
    if (error) {
      setMessageTone('error');
      setMessage(error);
      return;
    }
    setMessageTone('success');
    setMessage(firstTime ? '基本资料已保存。' : '资料已保存。');
  };

  return (
    <section className="content-card profile-editor">
      <div className="content-card__heading">
        <div>
          <p className="eyebrow">个人资料</p>
          <h1>{firstTime ? '首次资料完善' : '个人&账户信息'}</h1>
          <p>{firstTime ? '首次注册后必须先提交姓名、现住址与联系方式。联系方式可以分多行填写。' : '个人资料变更后，请在此处保存。'}</p>
        </div>
      </div>

      <div className="profile-editor__layout">
        <nav className="tab-list" aria-label="资料设置标签">
          <Tab active={tab === 'basic'} onClick={() => setTab('basic')}>基本信息</Tab>
          {!firstTime && <Tab active={tab === 'documents'} onClick={() => setTab('documents')}>证件信息</Tab>}
          {!firstTime && <Tab active={tab === 'payment'} onClick={() => setTab('payment')}>账户信息</Tab>}
          {!firstTime && <Tab active={tab === 'password'} onClick={() => setTab('password')}>重设密码</Tab>}
        </nav>

        <div className="profile-editor__panel">
          {tab === 'password' ? (
            <PasswordPanel onResetPassword={onResetPassword} />
          ) : (
            <form onSubmit={save}>
              {tab === 'basic' && <BasicFields draft={draft} firstTime={firstTime} setField={setField} />}
              {tab === 'documents' && <DocumentFields draft={draft} setField={setField} onUpload={onUpload} />}
              {tab === 'payment' && <PaymentFields draft={draft} setField={setField} onUpload={onUpload} />}
              <StatusMessage message={message} tone={messageTone} />
              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? '保存中…' : firstTime ? '保存基本资料并进入首页' : '保存'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Tab({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? 'tab-list__item is-active' : 'tab-list__item'} onClick={onClick}>
      {children}
    </button>
  );
}

function BasicFields({
  draft,
  firstTime,
  setField,
}: {
  draft: Profile;
  firstTime: boolean;
  setField: <K extends keyof Profile>(field: K, value: Profile[K]) => void;
}) {
  return (
    <FormSection title="基本信息" description="请按证件上的信息填写姓名。">
      <div className="form-grid form-grid--two">
        <Field label="中文姓" required>
          <input value={draft.lastNameCn} onChange={(event) => setField('lastNameCn', event.target.value)} required />
        </Field>
        <Field label="中文名" required>
          <input value={draft.firstNameCn} onChange={(event) => setField('firstNameCn', event.target.value)} required />
        </Field>
        <Field label="拼音姓">
          <input value={draft.lastNamePinyin} onChange={(event) => setField('lastNamePinyin', event.target.value)} />
        </Field>
        <Field label="拼音名">
          <input value={draft.firstNamePinyin} onChange={(event) => setField('firstNamePinyin', event.target.value)} />
        </Field>
        <Field label="片假名姓">
          <input value={draft.lastNameKana} onChange={(event) => setField('lastNameKana', event.target.value)} />
        </Field>
        <Field label="片假名名">
          <input value={draft.firstNameKana} onChange={(event) => setField('firstNameKana', event.target.value)} />
        </Field>
        <Field label="生日" required={!firstTime} hint={firstTime ? '首次资料可稍后补充。' : '例如：1992-01-01'}>
          <input type="date" value={draft.birthday} onChange={(event) => setField('birthday', event.target.value)} required={!firstTime} />
        </Field>
        <Field label="性别">
          <select value={draft.gender} onChange={(event) => setField('gender', event.target.value as Profile['gender'])}>
            <option value="">请选择</option>
            <option value="男">男</option>
            <option value="女">女</option>
            <option value="其他">其他</option>
          </select>
        </Field>
        <Field label="现住址" required hint="请填写当前可联系到本人的住址。">
          <textarea rows={3} value={draft.address} onChange={(event) => setField('address', event.target.value)} required />
        </Field>
        <Field label="联系方式" required hint="可分行填写手机号、微信、邮箱或紧急联系人。">
          <textarea rows={4} value={draft.tel} onChange={(event) => setField('tel', event.target.value)} required />
        </Field>
      </div>
    </FormSection>
  );
}

function DocumentFields({
  draft,
  setField,
  onUpload,
}: {
  draft: Profile;
  setField: <K extends keyof Profile>(field: K, value: Profile[K]) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const expected = draft.idType === 'passport' ? 1 : 2;
  const isResidence = draft.idType === 'residence';
  const isChinaId = draft.idType === 'china-id';

  return (
    <FormSection title="证件信息" description="有在留卡时必须选择在留卡；护照上传 1 张，其余证件上传正反面共 2 张。">
      <div className="form-grid form-grid--two">
        <Field label="身份证件类型选择" required>
          <select value={draft.idType} onChange={(event) => setField('idType', event.target.value as Profile['idType'])} required>
            <option value="">请选择</option>
            <option value="residence">在留卡</option>
            <option value="china-id">中国居民身份证</option>
            <option value="passport">护照</option>
          </select>
        </Field>
        <Field label="登录身份证件上传" required hint={draft.idType ? `当前需上传 ${expected} 个文件。` : '请先选择证件类型。'}>
          <FileNameInput value={draft.idFileNames} maximum={expected} onUpload={onUpload} onChange={(files) => setField('idFileNames', files)} />
        </Field>
        <Field label="国籍" required={isChinaId}>
          <input value={draft.nationality} onChange={(event) => setField('nationality', event.target.value)} />
        </Field>
        <Field label="证件号" required={isChinaId}>
          <input value={draft.idNumber} onChange={(event) => setField('idNumber', event.target.value)} />
        </Field>
        <Field label="证件有效期限" required={isChinaId}>
          <input type="date" value={draft.idExpiryDate} onChange={(event) => setField('idExpiryDate', event.target.value)} />
        </Field>
        {isResidence && (
          <Field label="在留资格" required>
            <input value={draft.residentStatus} onChange={(event) => setField('residentStatus', event.target.value)} />
          </Field>
        )}
        {isResidence && (
          <Field label="资格外活动许可" required>
            <select value={draft.activityPermission} onChange={(event) => setField('activityPermission', event.target.value as Profile['activityPermission'])}>
              <option value="">请选择</option>
              <option value="有">有</option>
              <option value="无">无</option>
            </select>
          </Field>
        )}
        <Field label="抚养" required>
          <select value={draft.dependents} onChange={(event) => setField('dependents', event.target.value as Profile['dependents'])}>
            <option value="">请选择</option>
            <option value="有">有</option>
            <option value="无">无</option>
          </select>
        </Field>
        <Field label="个人番号">
          <input value={draft.myNumber} onChange={(event) => setField('myNumber', event.target.value)} />
        </Field>
        <Field label="证件上住址所在地" required={isChinaId}>
          <input value={draft.addressOfLicense} onChange={(event) => setField('addressOfLicense', event.target.value)} />
        </Field>
        <Field label="（预）毕业院校名">
          <input value={draft.graduateUniversity} onChange={(event) => setField('graduateUniversity', event.target.value)} />
        </Field>
        <Field label="专业名">
          <input value={draft.faculty} onChange={(event) => setField('faculty', event.target.value)} />
        </Field>
        <Field label="（预）毕业时间">
          <input value={draft.graduateDate} onChange={(event) => setField('graduateDate', event.target.value)} />
        </Field>
        <Field label="（预）取得学位">
          <input value={draft.degree} onChange={(event) => setField('degree', event.target.value)} />
        </Field>
      </div>
    </FormSection>
  );
}

function PaymentFields({
  draft,
  setField,
  onUpload,
}: {
  draft: Profile;
  setField: <K extends keyof Profile>(field: K, value: Profile[K]) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const isJapan = draft.bankType === 'jp-bank';
  const isChina = draft.bankType === 'cn-bank';
  const isAlipay = draft.bankType === 'alipay';

  return (
    <FormSection title="工资收款账户" description="请填写能够接收工资的账户；如收款人不是本人，请补充收款人信息。">
      <div className="form-grid form-grid--two">
        <Field label="工资收款方式" required>
          <select value={draft.bankType} onChange={(event) => setField('bankType', event.target.value as Profile['bankType'])} required>
            <option value="">请选择</option>
            <option value="jp-bank">日本银行账户</option>
            <option value="cn-bank">中国银行账户</option>
            <option value="alipay">支付宝</option>
          </select>
        </Field>
        <Field label="银行卡/账户凭证上传" hint="需要上传正反面时请上传 2 个文件。">
          <FileNameInput value={draft.bankFileNames} maximum={2} onUpload={onUpload} onChange={(files) => setField('bankFileNames', files)} />
        </Field>
        <Field label={isAlipay ? '支付宝账户' : '银行名称'} required>
          <input value={draft.bankName} onChange={(event) => setField('bankName', event.target.value)} />
        </Field>
        {!isAlipay && (
          <Field label={isJapan ? '支店名称' : '开户支行'}>
            <input value={draft.bankBranch} onChange={(event) => setField('bankBranch', event.target.value)} />
          </Field>
        )}
        <Field label={isAlipay ? '支付宝账号' : '账号'} required>
          <input value={draft.bankAccountNumber} onChange={(event) => setField('bankAccountNumber', event.target.value)} />
        </Field>
        <Field label={isJapan ? '账户名义（片假名）' : '账户姓名'} required>
          <input value={draft.bankAccountHolder} onChange={(event) => setField('bankAccountHolder', event.target.value)} />
        </Field>
        {(isChina || isAlipay) && (
          <Field label="收款人是否本人">
            <select value={draft.payeeIsSelf} onChange={(event) => setField('payeeIsSelf', event.target.value as Profile['payeeIsSelf'])}>
              <option value="">请选择</option>
              <option value="是">是</option>
              <option value="否">否</option>
            </select>
          </Field>
        )}
        {(isChina || isAlipay) && draft.payeeIsSelf === '否' && (
          <>
            <Field label="收款人姓名" required>
              <input value={draft.payeeName} onChange={(event) => setField('payeeName', event.target.value)} />
            </Field>
            <Field label="收款人中国身份证号">
              <input value={draft.payeeIdNumber} onChange={(event) => setField('payeeIdNumber', event.target.value)} />
            </Field>
          </>
        )}
      </div>
    </FormSection>
  );
}

function PasswordPanel({
  onResetPassword,
}: {
  onResetPassword: (oldPassword: string, newPassword: string) => Promise<string | null>;
}) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setTone('error');
      setMessage('新密码至少需要 8 位。');
      return;
    }
    if (newPassword !== confirm) {
      setTone('error');
      setMessage('两次输入的新密码不一致。');
      return;
    }
    if (oldPassword === newPassword) {
      setTone('error');
      setMessage('新密码不能与旧密码相同。');
      return;
    }
    const error = await onResetPassword(oldPassword, newPassword);
    if (error) {
      setTone('error');
      setMessage(error);
      return;
    }
    setTone('success');
    setMessage('密码已更新。');
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
  };

  return (
    <form onSubmit={submit}>
      <FormSection title="重设密码">
        <div className="form-grid form-grid--two">
          <Field label="邮箱">
            <input disabled value="当前登录账户" />
          </Field>
          <Field label="旧密码" required>
            <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
          </Field>
          <Field label="新密码" required>
            <input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </Field>
          <Field label="确认新密码" required>
            <input type="password" minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          </Field>
        </div>
      </FormSection>
      <StatusMessage message={message} tone={tone} />
      <div className="form-actions"><button type="submit" className="primary-button">重设密码</button></div>
    </form>
  );
}
